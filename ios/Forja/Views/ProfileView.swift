import SwiftUI

// Pantalla deliberadamente acotada: solo sesión, peso actual, objetivo de
// entrenamiento y el toggle de Métricas Pro. Altura, check-in de sensación
// diaria, gráfico de peso, historial y export siguen viviendo en Biometría
// (BiometricsView.swift) — no se duplican acá.
struct ProfileView: View {
    @AppStorage("forja_unit") private var unit: String = "kg"

    @State private var weight = ""
    @State private var latestWeight: Double?
    @State private var weightStatus: String?

    @State private var trainingModes: [TrainingModeConfig] = []
    @State private var trainingMode: String?
    @State private var modeStatus: String?

    @State private var proEnabled = false
    @State private var proStatus: String?
    @State private var loadError = false

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

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForjaEyebrow(text: "Perfil · \(today)")
                    Text("Tu cuenta")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.forjaChalk)

                    AccountView()

                    ForjaCard {
                        Text("PESO ACTUAL")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundColor(.forjaSteel)
                        HStack(spacing: 8) {
                            TextField(latestWeight != nil ? String(format: "%.1f", toDisplay(latestWeight!)) : "ej. 78", text: $weight)
                                .keyboardType(.decimalPad)
                                .padding(8)
                                .background(Color.forjaPanel2)
                                .foregroundColor(.forjaChalk)
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.forjaLine))
                                .cornerRadius(6)
                            Button("Guardar") { Task { await saveWeight() } }
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.forjaBg)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .background(Color.forjaBrass)
                                .cornerRadius(6)
                        }
                        if let weightStatus {
                            Text(weightStatus).font(.system(size: 12, design: .monospaced)).foregroundColor(.forjaBrass)
                        }
                    }

                    ForjaCard {
                        Text("OBJETIVO DE ENTRENAMIENTO")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundColor(.forjaSteel)
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                            ForEach(trainingModes) { m in
                                Button(m.label.uppercased()) { Task { await saveTrainingMode(m.mode) } }
                                    .buttonStyle(TypeButtonStyle(active: trainingMode == m.mode))
                            }
                        }
                        if let modeStatus {
                            Text(modeStatus).font(.system(size: 12, design: .monospaced)).foregroundColor(.forjaEmber)
                        }
                    }

                    ForjaCard {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("MÉTRICAS PRO")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundColor(.forjaBrass)
                                Text("Activá métricas avanzadas de entrenamiento: tonelaje, zonas de intensidad, tests de potencia y más.")
                                    .font(.system(size: 12))
                                    .foregroundColor(.forjaSteel)
                            }
                            Spacer()
                            Toggle("", isOn: Binding(
                                get: { proEnabled },
                                set: { newValue in Task { await toggleProEnabled(newValue) } }
                            ))
                            .labelsHidden()
                            .tint(.forjaBrass)
                        }
                        if let proStatus {
                            Text(proStatus).font(.system(size: 12, design: .monospaced)).foregroundColor(.forjaEmber)
                        }
                    }

                    if loadError {
                        Text("No se pudo cargar tu perfil. Revisá tu conexión con el backend.")
                            .font(.system(size: 12))
                            .foregroundColor(.forjaSteel)
                    }
                }
                .padding(20)
            }
            .background(Color.forjaBg.ignoresSafeArea())
            .task { await loadAll() }
        }
    }

    private func loadAll() async {
        loadError = false
        do {
            async let profileTask = APIClient.shared.getProfile()
            async let modesTask = APIClient.shared.getTrainingModes()
            async let bioTask = APIClient.shared.getBiometrics()
            let (profile, modes, bio) = try await (profileTask, modesTask, bioTask)
            trainingMode = profile.training_mode
            proEnabled = profile.pro_enabled
            trainingModes = modes
            latestWeight = bio.first(where: { $0.weight_kg != nil })?.weight_kg
        } catch {
            loadError = true
        }
    }

    private func saveWeight() async {
        guard let w = Double(weight), w > 0 else {
            weightStatus = "Cargá un peso válido."
            return
        }
        do {
            try await APIClient.shared.upsertBiometric(BiometricPayload(date: today, weight_kg: fromDisplay(w)))
            latestWeight = fromDisplay(w)
            weightStatus = "Peso guardado ✓"
            weight = ""
        } catch {
            weightStatus = "No se pudo guardar. Revisá tu conexión."
        }
    }

    private func saveTrainingMode(_ mode: String) async {
        modeStatus = nil
        let previous = trainingMode
        trainingMode = mode
        do {
            try await APIClient.shared.putProfile(trainingMode: mode)
        } catch {
            trainingMode = previous
            modeStatus = "No se pudo guardar el modo. Probá de nuevo."
        }
    }

    private func toggleProEnabled(_ newValue: Bool) async {
        proStatus = nil
        let previous = proEnabled
        proEnabled = newValue // optimista: la pantalla debe sentirse instantánea
        do {
            try await APIClient.shared.putProfile(proEnabled: newValue)
        } catch {
            proEnabled = previous
            proStatus = "No se pudo guardar. Probá de nuevo."
        }
    }
}
