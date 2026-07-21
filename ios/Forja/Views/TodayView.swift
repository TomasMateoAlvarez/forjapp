import SwiftUI
import Network

struct SetRow: Identifiable {
    let id = UUID()
    var weight: String
    var reps: String
    var rir: String

    init(weight: String = "", reps: String = "", rir: String = "") {
        self.weight = weight
        self.reps = reps
        self.rir = rir
    }
}

let SUGGESTION_LABEL: [String: String] = [
    "subir_peso": "💡 Subí peso",
    "mantener": "➡️ Mantené el peso",
    "bajar": "🔻 Bajá el peso",
]

struct ExerciseEntry: Identifiable {
    let id = UUID()
    let name: String
    var sets: [SetRow]
    let latestRef: [LatestSet]
    let restSeconds: Int
    let targetReps: String?
    var suggestion: ProgressionSuggestion?

    init(name: String, latest: [LatestSet] = [], restSeconds: Int = 90, targetSets: Int? = nil, targetReps: String? = nil, suggestion: ProgressionSuggestion? = nil) {
        self.name = name
        self.latestRef = latest
        self.restSeconds = restSeconds
        self.targetReps = targetReps
        self.suggestion = suggestion
        if latest.isEmpty {
            let count = targetSets ?? 1
            sets = (0..<count).map { _ in SetRow() }
        } else {
            sets = latest.map { s in
                let w = s.weight_kg.truncatingRemainder(dividingBy: 1) == 0
                    ? String(Int(s.weight_kg))
                    : String(s.weight_kg)
                return SetRow(weight: w, reps: String(s.reps))
            }
        }
    }
}

// MARK: - Offline queue helpers

private let pendingKey = "forja_pending_sessions"

func loadPendingPayloads() -> [CreateSessionPayload] {
    guard let data = UserDefaults.standard.data(forKey: pendingKey) else { return [] }
    return (try? JSONDecoder().decode([CreateSessionPayload].self, from: data)) ?? []
}

func savePendingPayloads(_ payloads: [CreateSessionPayload]) {
    UserDefaults.standard.set(try? JSONEncoder().encode(payloads), forKey: pendingKey)
}

func enqueuePending(_ payload: CreateSessionPayload) {
    var queue = loadPendingPayloads()
    queue.append(payload)
    savePendingPayloads(queue)
}

func syncPendingQueue() async -> Bool {
    let queue = loadPendingPayloads()
    guard !queue.isEmpty else { return false }
    var remaining: [CreateSessionPayload] = []
    for payload in queue {
        do { _ = try await APIClient.shared.createSession(payload) }
        catch { remaining.append(payload) }
    }
    savePendingPayloads(remaining)
    return remaining.count < queue.count
}

// MARK: - TodayView

enum WorkoutSelection {
    case system(WorkoutType)
    case custom(CustomRoutine)

    var label: String {
        switch self {
        case .system(let t): return t.label
        case .custom(let r): return r.name
        }
    }
}

struct TodayView: View {
    @AppStorage("forja_unit") private var unit: String = "kg"

    @State private var types: [WorkoutType] = []
    @State private var customRoutines: [CustomRoutine] = []
    @State private var selected: WorkoutSelection?
    @State private var exercises: [ExerciseEntry] = []
    @State private var alertMessage: String?
    @State private var statusMessage: String?
    @State private var loading = false
    @State private var prRecords: [NewRecord] = []
    @State private var timerRemaining: Int = 0
    @State private var timerTotal: Int = 0
    @State private var timerActive = false
    @State private var sessionRpe: Int?
    @State private var sessionStartedAt: Date?
    @State private var cardioType: String = "cardio"
    @State private var cardioDuration = ""
    @State private var cardioNotes = ""
    @State private var cardioStatus: String?
    @State private var proEnabled = false
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    @Environment(\.scenePhase) private var scenePhase

    private var today: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
    }

    private var unitLabel: String { unit }

    private func toDisplay(_ kg: Double) -> Double {
        unit == "lb" ? (kg * 2.20462 * 10).rounded() / 10 : kg
    }

    private func fromDisplay(_ val: Double) -> Double {
        unit == "lb" ? val / 2.20462 : val
    }

    private func formatWeight(_ v: Double) -> String {
        v.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(v)) : String(v)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForjaEyebrow(text: "Hoy · \(today)")
                    Text("¿Qué entrenás hoy?")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.forjaChalk)

                    if selected == nil {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                            ForEach(types) { t in
                                Button(t.label.uppercased()) { Task { await select(.system(t)) } }
                                    .buttonStyle(TypeButtonStyle(active: false))
                            }
                        }
                        if !customRoutines.isEmpty {
                            ForjaEyebrow(text: "Mis rutinas").padding(.top, 8)
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                ForEach(customRoutines) { r in
                                    ZStack(alignment: .topTrailing) {
                                        Button(r.name.uppercased()) { Task { await select(.custom(r)) } }
                                            .buttonStyle(TypeButtonStyle(active: false))
                                        Text("PROPIA")
                                            .font(.system(size: 8, weight: .bold, design: .monospaced))
                                            .foregroundColor(.forjaEmber)
                                            .padding(4)
                                    }
                                }
                            }
                        }
                    } else if let sel = selected {
                        ForjaCard {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(sel.label.uppercased())
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundColor(.forjaChalk)
                                    if case .custom = sel {
                                        Text("PROPIA").font(.system(size: 8, design: .monospaced)).foregroundColor(.forjaEmber)
                                    }
                                }
                                Spacer()
                                Button("Cambiar") {
                                    selected = nil; exercises = []; alertMessage = nil
                                }
                                .foregroundColor(.forjaBrass)
                                .font(.system(size: 12))
                            }

                            if let alertMessage {
                                Text("⚠ \(alertMessage)")
                                    .font(.system(size: 13))
                                    .foregroundColor(.forjaEmber)
                                    .padding(10)
                                    .background(Color.forjaEmber.opacity(0.12))
                                    .cornerRadius(8)
                            }

                            if loading {
                                Text("Cargando ejercicios…")
                                    .foregroundColor(.forjaSteel)
                                    .font(.system(size: 13))
                            }

                            ForEach(exercises.indices, id: \.self) { exIdx in
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(exercises[exIdx].name)
                                        .foregroundColor(.forjaChalk)
                                        .font(.system(size: 14, weight: .medium))

                                    if let suggestion = exercises[exIdx].suggestion {
                                        Text(SUGGESTION_LABEL[suggestion.action] ?? suggestion.action)
                                            .font(.system(size: 11, design: .monospaced))
                                            .foregroundColor(.forjaBrass)
                                    }

                                    ForEach(exercises[exIdx].sets.indices, id: \.self) { setIdx in
                                        VStack(alignment: .leading, spacing: 2) {
                                            HStack(spacing: 8) {
                                                forjaField(placeholder: "Peso \(unitLabel)",
                                                           text: $exercises[exIdx].sets[setIdx].weight)
                                                forjaField(
                                                    placeholder: (exercises[exIdx].latestRef.isEmpty ? exercises[exIdx].targetReps : nil) ?? "Reps",
                                                    text: $exercises[exIdx].sets[setIdx].reps)
                                                forjaField(placeholder: "RIR",
                                                           text: $exercises[exIdx].sets[setIdx].rir)
                                                    .frame(width: 50)
                                                Button {
                                                    Task { await startTimerForSet(exIdx: exIdx, setIdx: setIdx) }
                                                } label: {
                                                    Text("✓")
                                                        .font(.system(size: 14, weight: .semibold))
                                                        .foregroundColor(.forjaBrass)
                                                        .frame(width: 32, height: 32)
                                                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.forjaBrass))
                                                }
                                                if exercises[exIdx].sets.count > 1 {
                                                    Button {
                                                        exercises[exIdx].sets.remove(at: setIdx)
                                                    } label: {
                                                        Image(systemName: "minus.circle.fill")
                                                            .foregroundColor(.forjaEmber)
                                                            .font(.system(size: 20))
                                                    }
                                                }
                                            }
                                            if setIdx < exercises[exIdx].latestRef.count {
                                                let ref = exercises[exIdx].latestRef[setIdx]
                                                Text("Última vez: \(formatWeight(toDisplay(ref.weight_kg)))\(unitLabel) × \(ref.reps)")
                                                    .font(.system(size: 11, design: .monospaced))
                                                    .foregroundColor(.forjaSteel)
                                            }
                                        }
                                    }

                                    Button {
                                        exercises[exIdx].sets.append(SetRow())
                                    } label: {
                                        Label("Agregar serie", systemImage: "plus.circle")
                                            .font(.system(size: 12))
                                            .foregroundColor(.forjaBrass)
                                    }
                                }
                                .padding(.vertical, 8)
                            }

                            if proEnabled {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("RPE DE LA SESIÓN (OPCIONAL)")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundColor(.forjaSteel)
                                HStack(spacing: 6) {
                                    ForEach(1...10, id: \.self) { n in
                                        Button("\(n)") {
                                            sessionRpe = sessionRpe == n ? nil : n
                                        }
                                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                        .foregroundColor(sessionRpe == n ? .forjaBg : .forjaSteel)
                                        .frame(width: 26, height: 26)
                                        .background(sessionRpe == n ? Color.forjaBrass : Color.forjaPanel2)
                                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(sessionRpe == n ? Color.forjaBrass : Color.forjaLine))
                                        .cornerRadius(5)
                                    }
                                }
                            }
                            }

                            ForjaPrimaryButton(title: "Guardar sesión") { Task { await save() } }
                        }
                    }

                    // Rest timer banner
                    if timerActive || timerRemaining > 0 {
                        HStack(spacing: 12) {
                            Text(timerRemaining >= 60
                                 ? "\(timerRemaining / 60):\(String(format: "%02d", timerRemaining % 60))"
                                 : "\(timerRemaining)s")
                                .font(.system(size: 22, weight: .bold, design: .monospaced))
                                .foregroundColor(.forjaBrass)
                                .frame(minWidth: 52, alignment: .leading)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Descanso")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(.forjaSteel)
                                GeometryReader { geo in
                                    ZStack(alignment: .leading) {
                                        RoundedRectangle(cornerRadius: 2).fill(Color.forjaLine).frame(height: 4)
                                        RoundedRectangle(cornerRadius: 2).fill(Color.forjaBrass)
                                            .frame(width: timerTotal > 0 ? geo.size.width * CGFloat(timerRemaining) / CGFloat(timerTotal) : 0, height: 4)
                                    }
                                }
                                .frame(height: 4)
                            }
                            Button {
                                timerActive = false; timerRemaining = 0
                            } label: {
                                Image(systemName: "xmark").foregroundColor(.forjaSteel).font(.system(size: 14))
                            }
                        }
                        .padding(12)
                        .background(Color.forjaPanel2)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.forjaBrass))
                        .cornerRadius(8)
                        .onReceive(ticker) { _ in
                            guard timerActive, timerRemaining > 0 else { return }
                            timerRemaining -= 1
                            if timerRemaining == 0 { timerActive = false }
                        }
                    }

                    if let statusMessage {
                        Text(statusMessage)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(.forjaBrass)
                    }

                    ForEach(prRecords.indices, id: \.self) { i in
                        let r = prRecords[i]
                        HStack(spacing: 6) {
                            Text("🏆")
                            Text("Nuevo PR en \(r.exercise_name) (\(r.type == "weight" ? "peso máximo" : "volumen"))")
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundColor(.forjaBrass)
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(red: 0.12, green: 0.11, blue: 0.08))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.forjaBrass))
                        .cornerRadius(8)
                    }

                    // Cardio/técnico-táctico (Manual Anselmi §2.6): módulo
                    // aparte de la sobrecarga, con la guía de orden como texto.
                    // Métricas Pro: solo visible con pro_enabled.
                    if proEnabled {
                    ForjaCard {
                        Text("CARDIO / TÉCNICO-TÁCTICO")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.forjaBrass)
                        Text("Si hacés cardio el mismo día que sobrecarga, hacelo después — nunca antes. La sesión completa idealmente no debería superar los 90 minutos.")
                            .font(.system(size: 12))
                            .foregroundColor(.forjaSteel)

                        Picker("", selection: $cardioType) {
                            Text("Cardio").tag("cardio")
                            Text("Técnico-táctico").tag("tecnico_tactico")
                            Text("Otro").tag("otro")
                        }
                        .pickerStyle(.segmented)

                        forjaField(placeholder: "Duración (min)", text: $cardioDuration)
                        forjaField(placeholder: "Notas (opcional)", text: $cardioNotes)

                        Button("Guardar sesión de cardio") { Task { await saveCardioSession() } }
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.forjaBg)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Color.forjaBrass)
                            .cornerRadius(6)

                        if let cardioStatus {
                            Text(cardioStatus).font(.system(size: 12, design: .monospaced)).foregroundColor(.forjaBrass)
                        }
                    }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 48)
            }
            .background(Color.forjaBg.ignoresSafeArea())
            .task {
                if let profile = try? await APIClient.shared.getProfile() { proEnabled = profile.pro_enabled }

                async let typesTask = APIClient.shared.getWorkoutTypes()
                async let routinesTask = APIClient.shared.getCustomRoutines()
                async let plannedTask = APIClient.shared.getPlannedForDate(today)

                let fetchedTypes = (try? await typesTask) ?? []
                let fetchedRoutines = (try? await routinesTask) ?? []
                let planned = try? await plannedTask

                types = fetchedTypes
                customRoutines = fetchedRoutines

                if let planned,
                   let matchedType = fetchedTypes.first(where: { $0.id == planned.workout_type_id }) {
                    await select(.system(matchedType))
                }

                if await syncPendingQueue() { statusMessage = "Sesiones pendientes sincronizadas ✓" }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task {
                        if await syncPendingQueue() { statusMessage = "Sesiones pendientes sincronizadas ✓" }
                    }
                }
            }
        }
    }

    private func forjaField(placeholder: String, text: Binding<String>) -> some View {
        TextField(placeholder, text: text)
            .keyboardType(.decimalPad)
            .padding(8)
            .background(Color.forjaPanel2)
            .foregroundColor(.forjaChalk)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.forjaLine))
            .cornerRadius(6)
    }

    // Descanso dinámico según %1RM (Manual Anselmi §2.5): si la serie tiene un
    // peso cargado, le pregunta al backend cuánto descanso conviene según su
    // intensidad relativa al PR — si falla o no hay peso, usa el default fijo
    // del ejercicio (no bloqueante).
    private func startTimerForSet(exIdx: Int, setIdx: Int) async {
        let ex = exercises[exIdx]
        let rest: Int
        if let weight = Double(ex.sets[setIdx].weight), weight > 0,
           let suggestion = try? await APIClient.shared.getRestSuggestion(exerciseName: ex.name, weightKg: fromDisplay(weight)) {
            rest = suggestion.rest_seconds
        } else {
            rest = ex.restSeconds
        }
        timerTotal = rest
        timerRemaining = rest
        timerActive = true
    }

    private func select(_ sel: WorkoutSelection) async {
        selected = sel
        statusMessage = nil
        prRecords = []
        timerActive = false; timerRemaining = 0
        sessionRpe = nil
        sessionStartedAt = Date()
        loading = true
        defer { loading = false }

        let infos: [ExerciseInfo]
        switch sel {
        case .system(let t):
            async let infosTask = APIClient.shared.getExercises(for: t.id)
            async let alertTask = APIClient.shared.checkAlert(typeId: t.id, date: today)
            infos = (try? await infosTask) ?? []
            let alertResult = try? await alertTask
            alertMessage = alertResult?.warning == true ? alertResult?.message : nil
        case .custom(let r):
            infos = (try? await APIClient.shared.getCustomRoutineExercises(r.id)) ?? []
            alertMessage = nil
        }

        var built = await withTaskGroup(of: ExerciseEntry.self) { group in
            for info in infos {
                group.addTask {
                    async let latestTask = APIClient.shared.getLatestSets(for: info.exercise_name)
                    async let suggestionTask = APIClient.shared.getProgressionSuggestion(exerciseName: info.exercise_name, mode: nil)
                    let latest = (try? await latestTask) ?? []
                    let suggestion = try? await suggestionTask
                    return ExerciseEntry(
                        name: info.exercise_name, latest: latest, restSeconds: info.default_rest_seconds,
                        targetSets: info.target_sets, targetReps: info.target_reps,
                        suggestion: suggestion?.action == "sin_datos" ? nil : suggestion)
                }
            }
            let names = infos.map(\.exercise_name)
            var result: [String: ExerciseEntry] = [:]
            for await entry in group {
                result[entry.name] = entry
            }
            return names.compactMap { result[$0] }
        }

        // Convert pre-filled weights to display unit
        if unit == "lb" {
            for i in built.indices {
                for j in built[i].sets.indices {
                    if let kg = Double(built[i].sets[j].weight) {
                        let lb = (kg * 2.20462 * 10).rounded() / 10
                        built[i].sets[j].weight = formatWeight(lb)
                    }
                }
            }
        }

        exercises = built
    }

    private func saveCardioSession() async {
        guard let duration = Int(cardioDuration), duration > 0 else {
            cardioStatus = "Cargá la duración en minutos."
            return
        }
        let payload = CardioSessionPayload(date: today, activity_type: cardioType, duration_min: duration, notes: cardioNotes.isEmpty ? nil : cardioNotes)
        do {
            _ = try await APIClient.shared.createCardioSession(payload)
            cardioStatus = "Sesión de cardio guardada ✓"
            cardioDuration = ""; cardioNotes = ""
        } catch {
            cardioStatus = "No se pudo guardar. Revisá el backend."
        }
    }

    private func save() async {
        guard let sel = selected else { return }
        let payload = exercises.compactMap { ex -> SessionExerciseInput? in
            let validSets = ex.sets.compactMap { s -> SessionSetInput? in
                guard let w = Double(s.weight), let r = Int(s.reps), w >= 0, r > 0 else { return nil }
                return SessionSetInput(weight_kg: fromDisplay(w), reps: r, rir: Int(s.rir))
            }
            return validSets.isEmpty ? nil : SessionExerciseInput(exercise_name: ex.name, sets: validSets)
        }
        guard !payload.isEmpty else {
            statusMessage = "Cargá al menos un ejercicio con peso y reps."
            return
        }
        let isoFormatter = ISO8601DateFormatter()
        let startedAt = sessionStartedAt.map { isoFormatter.string(from: $0) }
        let endedAt = isoFormatter.string(from: Date())
        var sessionPayload: CreateSessionPayload
        switch sel {
        case .system(let t):
            sessionPayload = CreateSessionPayload(date: today, workout_type_id: t.id, custom_routine_id: nil, exercises: payload)
        case .custom(let r):
            sessionPayload = CreateSessionPayload(date: today, workout_type_id: nil, custom_routine_id: r.id, exercises: payload)
        }
        sessionPayload.rpe = sessionRpe
        sessionPayload.started_at = startedAt
        sessionPayload.ended_at = endedAt
        do {
            let result = try await APIClient.shared.createSession(sessionPayload)
            prRecords = result.new_records
            statusMessage = "Sesión guardada en tu historial ✓"
        } catch APIError.network {
            enqueuePending(sessionPayload)
            statusMessage = "Sin conexión — guardado localmente. Se sincroniza al reconectarte."
        } catch {
            statusMessage = "No se pudo guardar. Revisá que el backend esté corriendo."
        }
        selected = nil
        exercises = []
        alertMessage = nil
        sessionRpe = nil
        sessionStartedAt = nil
    }
}

struct TypeButtonStyle: ButtonStyle {
    let active: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(active ? .forjaEmber : .forjaChalk)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Color.forjaPanel)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(active ? Color.forjaEmber : Color.forjaLine))
            .cornerRadius(8)
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}
