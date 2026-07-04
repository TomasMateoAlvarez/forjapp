import SwiftUI
import Charts

enum PlanningSubTab { case calendar, history }

struct PlanningView: View {
    @AppStorage("forja_unit") private var unit: String = "kg"

    @State private var subTab: PlanningSubTab = .calendar

    // Calendar state
    @State private var types: [WorkoutType] = []
    @State private var weekOffset: Int = 0
    @State private var selections: [String: String] = [:]
    @State private var doneDates: Set<String> = []
    @State private var planDays: [PlanDay] = []
    @State private var calStatus: String?

    // History state
    @State private var sessions: [SessionSummary] = []
    @State private var exerciseList: [ExerciseListEntry] = []
    @State private var selectedExercise: String?
    @State private var history: [HistoryEntry] = []
    @State private var exercisePR: PersonalRecord?
    @State private var chartMetric: ChartMetric = .orm
    @State private var chartGranularity: ChartGranularity = .session
    @State private var selectedStat: DayStat?

    enum ChartMetric { case orm, volume }
    enum ChartGranularity: String, CaseIterable {
        case session = "Sesión"; case week = "Semana"; case month = "Mes"
    }

    struct DayStat: Identifiable {
        let id: String
        let date: String
        let label: String
        let estOneRM_kg: Double
        let totalVolume_kg: Double
        let sets: [HistoryEntry]
    }

    private var unitLabel: String { unit }

    private func toDisplay(_ kg: Double) -> Double {
        unit == "lb" ? (kg * 2.20462 * 10).rounded() / 10 : kg
    }

    private func mondayOf(_ dateStr: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: dateStr) else { return dateStr }
        var cal = Calendar(identifier: .iso8601); cal.firstWeekday = 2
        let monday = cal.date(from: cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: d))!
        return f.string(from: monday)
    }

    private func groupKey(_ dateStr: String) -> String {
        switch chartGranularity {
        case .session: return dateStr
        case .week: return mondayOf(dateStr)
        case .month: return String(dateStr.prefix(7))
        }
    }

    private func groupLabel(_ key: String) -> String {
        chartGranularity == .month ? String(key.prefix(7)) : String(key.dropFirst(5))
    }

    private var chartData: [DayStat] {
        var byGroup: [String: [HistoryEntry]] = [:]
        for h in history { byGroup[groupKey(h.date), default: []].append(h) }
        return byGroup.sorted { $0.key < $1.key }.map { k, sets in
            let estOneRM_kg = sets.map { s in s.weight_kg * (1 + Double(s.reps) / 30) }.max() ?? 0
            // Max session volume within group
            var sessionVols: [String: Double] = [:]
            for s in sets { sessionVols[s.date, default: 0] += s.weight_kg * Double(s.reps) }
            let totalVolume_kg = sessionVols.values.max() ?? 0
            return DayStat(id: k, date: k, label: groupLabel(k), estOneRM_kg: estOneRM_kg, totalVolume_kg: totalVolume_kg, sets: sets)
        }
    }

    private func yValue(for stat: DayStat) -> Double {
        toDisplay(chartMetric == .orm ? stat.estOneRM_kg : stat.totalVolume_kg)
    }

    private let dow = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

    private var baseMonday: Date {
        let cal = Calendar(identifier: .iso8601)
        let today = Date()
        let weekday = cal.component(.weekday, from: today)
        let daysFromMonday = (weekday + 5) % 7
        return cal.date(byAdding: .day, value: -daysFromMonday, to: today)!
    }

    private var currentMonday: Date {
        Calendar(identifier: .iso8601).date(byAdding: .weekOfYear, value: weekOffset, to: baseMonday)!
    }

    private var weekStart: String { isoDate(currentMonday) }

    private var weekDates: [String] {
        let cal = Calendar(identifier: .iso8601)
        return (0..<7).map { isoDate(cal.date(byAdding: .day, value: $0, to: currentMonday)!) }
    }

    private func weekLabel(for offset: Int) -> String {
        let cal = Calendar(identifier: .iso8601)
        let monday = cal.date(byAdding: .weekOfYear, value: offset, to: baseMonday)!
        let sunday = cal.date(byAdding: .day, value: 6, to: monday)!
        let f = DateFormatter(); f.dateFormat = "d/M"
        return "Del \(f.string(from: monday)) al \(f.string(from: sunday))"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForjaEyebrow(text: "Planificación")
                    Text("Tu entrenamiento")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.forjaChalk)

                    Picker("", selection: $subTab) {
                        Text("Calendario").tag(PlanningSubTab.calendar)
                        Text("Historial").tag(PlanningSubTab.history)
                    }
                    .pickerStyle(.segmented)

                    if subTab == .calendar {
                        calendarContent
                    } else {
                        historialContent
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 48)
            }
            .background(Color.forjaBg.ignoresSafeArea())
            .task {
                types = (try? await APIClient.shared.getWorkoutTypes()) ?? []
                sessions = (try? await APIClient.shared.getSessions()) ?? []
                exerciseList = (try? await APIClient.shared.getExerciseList()) ?? []
            }
            .task(id: weekOffset) {
                await loadPlan()
            }
            .onChange(of: subTab) { _, newTab in
                if newTab == .history {
                    Task {
                        sessions = (try? await APIClient.shared.getSessions()) ?? []
                        exerciseList = (try? await APIClient.shared.getExerciseList()) ?? []
                    }
                }
            }
        }
    }

    // MARK: - Calendar sub-tab

    @ViewBuilder
    private var calendarContent: some View {
        HStack(spacing: 8) {
            Button {
                weekOffset -= 1
            } label: {
                Image(systemName: "chevron.left")
                    .foregroundColor(weekOffset > -8 ? .forjaBrass : .forjaSteel)
                    .frame(width: 32, height: 36)
            }
            .disabled(weekOffset <= -8)

            Menu {
                ForEach(-8...4, id: \.self) { offset in
                    Button(weekLabel(for: offset) + (offset == 0 ? " (esta semana)" : "")) {
                        weekOffset = offset
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(weekLabel(for: weekOffset) + (weekOffset == 0 ? " (esta semana)" : ""))
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(.forjaChalk)
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10))
                        .foregroundColor(.forjaSteel)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }

            Button {
                weekOffset += 1
            } label: {
                Image(systemName: "chevron.right")
                    .foregroundColor(weekOffset < 4 ? .forjaBrass : .forjaSteel)
                    .frame(width: 32, height: 36)
            }
            .disabled(weekOffset >= 4)
        }
        .padding(.horizontal, 12)
        .background(Color.forjaPanel)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.forjaLine, lineWidth: 1))
        .cornerRadius(8)

        ForjaCard {
            ForEach(Array(weekDates.enumerated()), id: \.offset) { i, date in
                let info = planDays.first(where: { $0.date == date })
                let hasActual = info?.actual_label != nil
                let hasPlanned = info?.planned_workout_type_id != nil
                let done = doneDates.contains(date)
                let showMarcar = hasPlanned && !hasActual && !done

                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(dow[i])
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.forjaSteel)
                            .frame(width: 36, alignment: .leading)

                        Picker("", selection: Binding(
                            get: { selections[date] ?? "" },
                            set: { selections[date] = $0 }
                        )) {
                            Text("Descanso").tag("")
                            ForEach(types) { t in Text(t.label).tag(t.id) }
                        }
                        .pickerStyle(.menu)
                        .tint(.forjaChalk)

                        Spacer()

                        if done {
                            Text("HECHO")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(.forjaEmber)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .overlay(Capsule().stroke(Color.forjaEmber))
                        } else if showMarcar {
                            Button("Marcar") { Task { await markDone(date) } }
                                .font(.system(size: 12))
                                .foregroundColor(.forjaBrass)
                        }
                    }

                    if let actualLabel = info?.actual_label {
                        HStack(spacing: 4) {
                            Text("✓ \(actualLabel)")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(.forjaBrass)
                            if let plannedLabel = info?.planned_label, plannedLabel != actualLabel {
                                Text("(plan: \(plannedLabel))")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundColor(.forjaSteel)
                            }
                        }
                        .padding(.leading, 36)
                    }
                }
                .padding(.vertical, 8)
            }

            ForjaPrimaryButton(title: "Guardar plan de la semana") { Task { await save() } }

            if let calStatus {
                Text(calStatus)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(.forjaBrass)
            }
        }

        Text("Los recordatorios push quedan para la versión de producción.")
            .font(.system(size: 12))
            .foregroundColor(.forjaSteel)
    }

    // MARK: - History sub-tab

    @ViewBuilder
    private var historialContent: some View {
        ForjaCard {
            Text("CALENDARIO RECIENTE")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.forjaChalk)
            if sessions.isEmpty {
                Text("Todavía no hay sesiones guardadas.")
                    .foregroundColor(.forjaSteel)
                    .font(.system(size: 13))
            }
            ForEach(sessions) { s in
                HStack {
                    Text(s.date)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(.forjaSteel)
                        .fixedSize()
                    Spacer(minLength: 8)
                    Text(s.workout_label.uppercased())
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.forjaChalk)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .padding(.vertical, 6)
            }
        }

        ForjaCard {
            Text("PROGRESO POR EJERCICIO")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.forjaChalk)
            if exerciseList.isEmpty {
                Text("Cargá una sesión para ver evolución acá.")
                    .foregroundColor(.forjaSteel)
                    .font(.system(size: 13))
            }
            ForEach(exerciseList) { e in
                Button {
                    Task {
                        selectedExercise = e.exercise_name
                        exercisePR = nil
                        chartMetric = .orm
                        chartGranularity = .session
                        selectedStat = nil
                        async let histTask = APIClient.shared.getExerciseHistory(e.exercise_name)
                        async let prTask = APIClient.shared.getExerciseRecords(e.exercise_name)
                        history = (try? await histTask) ?? []
                        exercisePR = try? await prTask
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(e.exercise_name)
                            .foregroundColor(.forjaChalk)
                            .font(.system(size: 14))
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Text("\(e.entries) registros · último \(e.last_date)")
                            .foregroundColor(.forjaSteel)
                            .font(.system(size: 11, design: .monospaced))
                    }
                }
                .padding(.vertical, 6)
            }

            if let sel = selectedExercise {
                Text(sel.uppercased())
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.forjaBrass)
                    .padding(.top, 8)

                if chartData.count >= 2 {
                    Picker("", selection: $chartMetric) {
                        Text("Fuerza (1RM est.)").tag(ChartMetric.orm)
                        Text("Volumen").tag(ChartMetric.volume)
                    }
                    .pickerStyle(.segmented)
                    .padding(.vertical, 4)
                    .onChange(of: chartMetric) { _, _ in selectedStat = nil }

                    Picker("", selection: $chartGranularity) {
                        ForEach(ChartGranularity.allCases, id: \.self) { g in
                            Text(g.rawValue).tag(g)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.bottom, 4)
                    .onChange(of: chartGranularity) { _, _ in selectedStat = nil }

                    exerciseChart
                }

                if let pr = exercisePR {
                    HStack(spacing: 4) {
                        Text("🏆")
                        Text("Peso: \(String(format: "%.1f", toDisplay(pr.best_weight_kg)))\(unitLabel) (\(pr.best_weight_date))  ·  Vol: \(String(format: "%.0f", toDisplay(pr.best_volume)))\(unitLabel) (\(pr.best_volume_date))")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.forjaBrass)
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(red: 0.12, green: 0.11, blue: 0.08))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.forjaBrass))
                    .cornerRadius(6)
                    .padding(.bottom, 4)
                }

                ForEach(history) { h in
                    HStack(spacing: 8) {
                        Text(h.date).foregroundColor(.forjaChalk).fixedSize()
                        Text("S\(h.set_number)").foregroundColor(.forjaSteel).fixedSize()
                        Spacer(minLength: 4)
                        Text("\(String(format: "%.1f", toDisplay(h.weight_kg)))\(unitLabel)").foregroundColor(.forjaBrass).fixedSize()
                        Text("\(h.reps)r").foregroundColor(.forjaBrass).fixedSize()
                    }
                    .font(.system(size: 13, design: .monospaced))
                    .padding(.vertical, 4)
                }
            }
        }
    }

    @ViewBuilder
    private var exerciseChart: some View {
        let color: Color = chartMetric == .orm ? .forjaBrass : .forjaEmber

        ZStack(alignment: .topLeading) {
            Chart(chartData) { point in
                LineMark(
                    x: .value("Fecha", point.label),
                    y: .value(chartMetric == .orm ? "1RM est." : "Vol",
                              yValue(for: point))
                )
                .foregroundStyle(color)
                PointMark(
                    x: .value("Fecha", point.label),
                    y: .value(chartMetric == .orm ? "1RM est." : "Vol",
                              yValue(for: point))
                )
                .foregroundStyle(selectedStat?.id == point.id ? Color.white : color)
                .symbolSize(selectedStat?.id == point.id ? 80 : 30)
            }
            .frame(height: 130)
            .chartXAxis {
                AxisMarks { _ in AxisValueLabel().foregroundStyle(Color.forjaSteel) }
            }
            .chartYAxis {
                AxisMarks(position: .leading) { _ in AxisValueLabel().foregroundStyle(Color.forjaSteel) }
            }
            .chartOverlay { proxy in
                GeometryReader { geo in
                    Rectangle().fill(.clear).contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 0).onChanged { value in
                                let plotArea = geo[proxy.plotAreaFrame]
                                let x = value.location.x - plotArea.origin.x
                                guard chartData.count > 1 else { return }
                                let step = plotArea.width / CGFloat(chartData.count - 1)
                                let idx = max(0, min(chartData.count - 1, Int((x / step).rounded())))
                                selectedStat = chartData[idx]
                            }
                            .onEnded { _ in selectedStat = nil }
                        )
                }
            }

            if let stat = selectedStat {
                VStack(alignment: .leading, spacing: 2) {
                    Text(stat.date)
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundColor(.forjaSteel)
                    Text(chartMetric == .orm
                         ? "1RM est.: \(String(format: "%.1f", toDisplay(stat.estOneRM_kg)))\(unitLabel)"
                         : "Vol: \(String(format: "%.0f", toDisplay(stat.totalVolume_kg)))\(unitLabel)")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundColor(.forjaBrass)
                    ForEach(stat.sets) { s in
                        Text("\(String(format: "%.1f", toDisplay(s.weight_kg)))\(unitLabel) × \(s.reps)")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.forjaChalk)
                    }
                }
                .padding(8)
                .background(Color.forjaPanel)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.forjaLine))
                .cornerRadius(6)
                .padding(.top, 4)
                .allowsHitTesting(false)
            }
        }
        .padding(.bottom, 8)
    }

    // MARK: - Actions

    private func loadPlan() async {
        calStatus = nil
        selections = [:]
        doneDates = []
        planDays = []
        if let plan = try? await APIClient.shared.getPlan(weekStart: weekStart) {
            planDays = plan.days
            for d in plan.days {
                if let pid = d.planned_workout_type_id { selections[d.date] = pid }
                if d.done { doneDates.insert(d.date) }
            }
        }
    }

    private func save() async {
        let days = weekDates.compactMap { date -> PlanDayInput? in
            guard let typeId = selections[date], !typeId.isEmpty else { return nil }
            return PlanDayInput(date: date, workout_type_id: typeId)
        }
        guard !days.isEmpty else { calStatus = "Elegí al menos un día."; return }
        do {
            try await APIClient.shared.savePlan(SavePlanPayload(week_start: weekStart, days: days))
            calStatus = "Plan guardado ✓"
        } catch {
            calStatus = "No se pudo guardar."
        }
    }

    private func markDone(_ date: String) async {
        try? await APIClient.shared.markPlanDayDone(weekStart: weekStart, date: date)
        doneDates.insert(date)
    }

    private func isoDate(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: d)
    }
}
