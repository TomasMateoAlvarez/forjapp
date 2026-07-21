import SwiftUI
import Charts

struct BiometricsView: View {
    @AppStorage("forja_unit") private var unit: String = "kg"

    @State private var weight = ""
    @State private var feeling: Int?
    @State private var history: [Biometric] = []
    @State private var statusMessage: String?

    @State private var heightCm: Double? = nil
    @State private var editingHeight = false
    @State private var heightInput = ""
    @State private var heightStatus: String?

    @State private var strengthTests: [StrengthTest] = []
    @State private var testType: String = "salto_simple"
    @State private var flightTime = ""
    @State private var contactTime = ""
    @State private var dropHeight = ""
    @State private var testStatus: String?

    @State private var proEnabled = false

    @State private var weightGranularity: ChartGranularity = .session

    private let feelings: [(Int, String)] = [
        (1, "🪫 Muy cansado"), (2, "😐 Flojo"), (3, "🙂 Normal"), (4, "💪 Con energía"), (5, "🔥 Excelente"),
    ]

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

    enum ChartGranularity: String, CaseIterable {
        case session = "Sesión"
        case week = "Semana"
        case month = "Mes"
    }

    struct WeightPoint: Identifiable {
        let id: String
        let label: String
        let weight_kg: Double
    }

    struct JumpPoint: Identifiable {
        let id: Int
        let label: String
        let jump_height_cm: Double
    }

    private func mondayOf(_ dateStr: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: dateStr) else { return dateStr }
        var cal = Calendar(identifier: .iso8601)
        cal.firstWeekday = 2
        let monday = cal.date(from: cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: d))!
        return f.string(from: monday)
    }

    private func groupKey(_ dateStr: String, granularity: ChartGranularity) -> String {
        switch granularity {
        case .session: return dateStr
        case .week: return mondayOf(dateStr)
        case .month: return String(dateStr.prefix(7))
        }
    }

    private func groupLabel(_ key: String, granularity: ChartGranularity) -> String {
        granularity == .month ? String(key.prefix(7)) : String(key.dropFirst(5))
    }

    private var weightChartData: [WeightPoint] {
        var byGroup: [String: [Double]] = [:]
        for h in history {
            guard let w = h.weight_kg else { continue }
            let key = groupKey(h.date, granularity: weightGranularity)
            byGroup[key, default: []].append(w)
        }
        return byGroup.sorted { $0.key < $1.key }.map { key, weights in
            WeightPoint(id: key, label: groupLabel(key, granularity: weightGranularity), weight_kg: weights.max()!)
        }
    }

    private var jumpChartData: [JumpPoint] {
        strengthTests
            .filter { $0.test_type == "salto_simple" }
            .reversed()
            .map { JumpPoint(id: $0.id, label: String($0.date.dropFirst(5)), jump_height_cm: $0.jump_height_cm) }
    }

    private var latestWeight: Double? {
        history.first { $0.weight_kg != nil }?.weight_kg
    }

    private var imc: Double? {
        guard let w = latestWeight, let h = heightCm, h > 0 else { return nil }
        return w / pow(h / 100, 2)
    }

    private func imcCategory(_ val: Double) -> String {
        switch val {
        case ..<18.5: return "Bajo peso"
        case 18.5..<25: return "Normal"
        case 25..<30: return "Sobrepeso"
        default: return "Obesidad"
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForjaEyebrow(text: "Biometría · \(today)")

                    HStack(alignment: .firstTextBaseline) {
                        Text("¿Cómo estás hoy?")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.forjaChalk)
                        Spacer()
                        Picker("", selection: $unit) {
                            Text("kg").tag("kg")
                            Text("lb").tag("lb")
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 90)
                    }

                    AccountView()

                    // Height (master data) + IMC
                    ForjaCard {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("ALTURA")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundColor(.forjaSteel)
                                if let h = heightCm {
                                    Text("\(Int(h)) cm")
                                        .font(.system(size: 14))
                                        .foregroundColor(.forjaChalk)
                                } else {
                                    Text("— (no cargada)")
                                        .font(.system(size: 13))
                                        .foregroundColor(.forjaSteel)
                                }
                            }
                            Spacer()
                            Button(editingHeight ? "Cancelar" : "✏ Editar") {
                                editingHeight.toggle()
                                heightInput = heightCm.map { String(Int($0)) } ?? ""
                                heightStatus = nil
                            }
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(.forjaBrass)
                        }

                        if editingHeight {
                            HStack(spacing: 8) {
                                TextField("ej. 178", text: $heightInput)
                                    .keyboardType(.decimalPad)
                                    .padding(8)
                                    .background(Color.forjaPanel2)
                                    .foregroundColor(.forjaChalk)
                                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.forjaLine))
                                    .cornerRadius(6)
                                Button("Guardar") { Task { await saveHeight() } }
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundColor(.forjaChalk)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(Color.forjaBrass)
                                    .cornerRadius(6)
                            }
                            if let heightStatus {
                                Text(heightStatus)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundColor(.forjaEmber)
                            }
                        }

                        if let val = imc {
                            Divider().background(Color.forjaLine)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("IMC ESTIMADO")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundColor(.forjaSteel)
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Text(String(format: "%.1f", val))
                                        .font(.system(size: 20, design: .monospaced))
                                        .foregroundColor(.forjaBrass)
                                    Text("(\(imcCategory(val)))")
                                        .font(.system(size: 12))
                                        .foregroundColor(.forjaChalk)
                                }
                            }
                        }
                    }

                    // Daily check-in (sin altura)
                    ForjaCard {
                        forjaField(placeholder: "Peso (\(unitLabel))", text: $weight)

                        Text("CÓMO TE SENTÍS").font(.system(size: 10, design: .monospaced)).foregroundColor(.forjaSteel)
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                            ForEach(feelings, id: \.0) { value, label in
                                Button(label) { feeling = value }
                                    .buttonStyle(TypeButtonStyle(active: feeling == value))
                            }
                        }

                        ForjaPrimaryButton(title: "Guardar check-in") { Task { await save() } }
                    }

                    if let statusMessage {
                        Text(statusMessage).font(.system(size: 12, design: .monospaced)).foregroundColor(.forjaBrass)
                    }

                    // Test de salto/pliometría (Manual Anselmi §1.4) — sin
                    // plataforma real, alcanza con tiempo de vuelo cronometrado.
                    // Métricas Pro: solo visible con pro_enabled (Perfil → Métricas Pro).
                    if proEnabled {
                    ForjaCard {
                        Text("TEST DE SALTO")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundColor(.forjaSteel)
                        Text("Cronometrá el tiempo de vuelo del salto y cargalo acá. Para drop jump, sumá tiempo de contacto y altura de caída.")
                            .font(.system(size: 12))
                            .foregroundColor(.forjaSteel)

                        Picker("", selection: $testType) {
                            Text("Salto simple").tag("salto_simple")
                            Text("Drop jump").tag("drop_jump")
                        }
                        .pickerStyle(.segmented)

                        forjaField(placeholder: "Tiempo de vuelo (s)", text: $flightTime)
                        if testType == "drop_jump" {
                            forjaField(placeholder: "Tiempo de contacto (s)", text: $contactTime)
                            forjaField(placeholder: "Altura de caída (cm)", text: $dropHeight)
                        }

                        Button("Guardar test") { Task { await saveStrengthTest() } }
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.forjaBg)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Color.forjaBrass)
                            .cornerRadius(6)

                        if let testStatus {
                            Text(testStatus).font(.system(size: 12, design: .monospaced)).foregroundColor(.forjaBrass)
                        }

                        if jumpChartData.count >= 2 {
                            Text("ALTURA DE SALTO (CM)")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundColor(.forjaSteel)
                                .padding(.top, 6)
                            Chart(jumpChartData) { point in
                                LineMark(x: .value("Fecha", point.label), y: .value("Altura", point.jump_height_cm))
                                    .foregroundStyle(Color.forjaBrass)
                                PointMark(x: .value("Fecha", point.label), y: .value("Altura", point.jump_height_cm))
                                    .foregroundStyle(Color.forjaBrass)
                            }
                            .frame(height: 120)
                            .chartXAxis { AxisMarks { _ in AxisValueLabel().foregroundStyle(Color.forjaSteel) } }
                            .chartYAxis { AxisMarks(position: .leading) { _ in AxisValueLabel().foregroundStyle(Color.forjaSteel) } }
                        }

                        ForEach(strengthTests) { t in
                            HStack {
                                Text(t.date).font(.system(size: 12, design: .monospaced)).foregroundColor(.forjaSteel)
                                Spacer()
                                Text(strengthTestSummary(t)).font(.system(size: 12)).foregroundColor(.forjaSteel)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    }

                    // Weight chart with granularity
                    if weightChartData.count >= 2 {
                        ForjaCard {
                            Text("PESO CORPORAL (\(unitLabel.uppercased()))")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(.forjaChalk)

                            Picker("", selection: $weightGranularity) {
                                ForEach(ChartGranularity.allCases, id: \.self) { g in
                                    Text(g.rawValue).tag(g)
                                }
                            }
                            .pickerStyle(.segmented)

                            Chart(weightChartData) { point in
                                LineMark(
                                    x: .value("Fecha", point.label),
                                    y: .value("Peso", toDisplay(point.weight_kg))
                                )
                                .foregroundStyle(Color.forjaEmber)
                                PointMark(
                                    x: .value("Fecha", point.label),
                                    y: .value("Peso", toDisplay(point.weight_kg))
                                )
                                .foregroundStyle(Color.forjaEmber)
                            }
                            .frame(height: 120)
                            .chartXAxis {
                                AxisMarks { _ in AxisValueLabel().foregroundStyle(Color.forjaSteel) }
                            }
                            .chartYAxis {
                                AxisMarks(position: .leading) { v in
                                    AxisValueLabel {
                                        if let val = v.as(Double.self) {
                                            Text("\(Int(val))\(unitLabel)").foregroundStyle(Color.forjaSteel)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    ForjaCard {
                        Text("HISTORIAL").font(.system(size: 12, weight: .semibold)).foregroundColor(.forjaChalk)
                        if history.isEmpty { Text("Todavía no hay check-ins.").foregroundColor(.forjaSteel).font(.system(size: 13)) }
                        ForEach(history) { h in
                            HStack {
                                Text(h.date).font(.system(size: 12, design: .monospaced)).foregroundColor(.forjaSteel)
                                Spacer()
                                if let w = h.weight_kg {
                                    Text("\(String(format: "%.1f", toDisplay(w)))\(unitLabel)")
                                        .foregroundColor(.forjaSteel).font(.system(size: 12))
                                } else {
                                    Text("—").foregroundColor(.forjaSteel).font(.system(size: 12))
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                .padding(20)
            }
            .background(Color.forjaBg.ignoresSafeArea())
            .task {
                history = (try? await APIClient.shared.getBiometrics()) ?? []
                if let p = try? await APIClient.shared.getProfile() {
                    heightCm = p.height_cm
                    proEnabled = p.pro_enabled
                }
                strengthTests = (try? await APIClient.shared.getStrengthTests()) ?? []
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

    private func strengthTestSummary(_ t: StrengthTest) -> String {
        let label = t.test_type == "drop_jump" ? "Drop jump" : "Salto simple"
        var summary = "\(label) · \(String(format: "%.1f", t.jump_height_cm))cm"
        if let q = t.reactive_stability_q {
            summary += " · Q \(String(format: "%.2f", q))"
        }
        return summary
    }

    private func saveStrengthTest() async {
        guard let flight = Double(flightTime), flight > 0 else {
            testStatus = "Cargá el tiempo de vuelo (segundos)."
            return
        }
        if testType == "drop_jump", !(Double(contactTime).map({ $0 > 0 }) ?? false) {
            testStatus = "Drop jump requiere el tiempo de contacto (segundos)."
            return
        }
        var payload = StrengthTestPayload(date: today, test_type: testType, flight_time_sec: flight)
        if testType == "drop_jump" {
            payload.contact_time_sec = Double(contactTime)
            payload.drop_height_cm = Double(dropHeight)
        }
        do {
            _ = try await APIClient.shared.createStrengthTest(payload)
            strengthTests = (try? await APIClient.shared.getStrengthTests()) ?? []
            testStatus = "Test guardado ✓"
            flightTime = ""; contactTime = ""; dropHeight = ""
        } catch {
            testStatus = "No se pudo guardar el test. Revisá el backend."
        }
    }

    private func saveHeight() async {
        guard let val = Double(heightInput), val > 50, val < 280 else {
            heightStatus = "Altura inválida."
            return
        }
        do {
            try await APIClient.shared.putProfile(heightCm: val)
            heightCm = val
            editingHeight = false
            heightStatus = nil
            heightInput = ""
        } catch {
            heightStatus = "No se pudo guardar."
        }
    }

    private func save() async {
        guard !weight.isEmpty || feeling != nil else {
            statusMessage = "Cargá al menos un dato."
            return
        }
        let weight_kg = Double(weight).map { fromDisplay($0) }
        do {
            try await APIClient.shared.upsertBiometric(
                BiometricPayload(date: today, weight_kg: weight_kg, feeling: feeling)
            )
            history = (try? await APIClient.shared.getBiometrics()) ?? []
            statusMessage = "Check-in de hoy guardado ✓"
            weight = ""; feeling = nil
        } catch {
            statusMessage = "No se pudo guardar. Revisá el backend."
        }
    }
}
