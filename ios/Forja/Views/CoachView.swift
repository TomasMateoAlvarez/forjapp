import SwiftUI

struct CoachView: View {
    @State private var code: String?
    @State private var codeStatus: String?
    @State private var codeLoading = false

    @State private var linkCode = ""
    @State private var linkStatus: String?
    @State private var linkLoading = false

    @State private var pending: [PendingRequest] = []
    @State private var athletes: [CoachAthlete] = []
    @State private var selectedAthlete: CoachAthlete?
    @State private var loadError = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let athlete = selectedAthlete {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                ForjaEyebrow(text: "Coach · viendo a \(athlete.athlete_email)")
                                Text("Progreso del atleta")
                                    .font(.system(size: 22, weight: .bold))
                                    .foregroundColor(.forjaChalk)
                            }
                            Spacer()
                            Button("← Volver") { selectedAthlete = nil }
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundColor(.forjaBrass)
                        }
                        Text("Vista de solo lectura — no podés editar el plan ni las series de tu atleta.")
                            .font(.system(size: 12))
                            .foregroundColor(.forjaSteel)

                        PlanningView(athleteId: athlete.athlete_user_id, readOnly: true)
                            .frame(minHeight: 600)
                    } else {
                        ForjaEyebrow(text: "Coach")
                        Text("Vínculo con tu coach o atletas")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.forjaChalk)

                        if loadError {
                            VStack(spacing: 8) {
                                Text("No pudimos cargar esta sección").foregroundColor(.forjaChalk)
                                Text("Revisá tu conexión con el backend.").font(.system(size: 12)).foregroundColor(.forjaSteel)
                                Button("Reintentar") { Task { await loadAll() } }
                                    .foregroundColor(.forjaBrass)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(20)
                        } else {
                            ForjaCard {
                                Text("TU CÓDIGO PARA COMPARTIR CON TU COACH")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(.forjaBrass)
                                Text("Generá un código y pasáselo a tu coach. Vos decidís si aceptás el pedido de vínculo.")
                                    .font(.system(size: 12))
                                    .foregroundColor(.forjaSteel)
                                if let code {
                                    Text(code)
                                        .font(.system(size: 22, weight: .bold, design: .monospaced))
                                        .foregroundColor(.forjaBrass)
                                        .tracking(2)
                                } else {
                                    Text("Todavía no generaste un código.")
                                        .font(.system(size: 13))
                                        .foregroundColor(.forjaSteel)
                                }
                                Button(codeLoading ? "…" : (code != nil ? "Regenerar código" : "Generar código")) {
                                    Task { await generateCode() }
                                }
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.forjaBg)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .background(Color.forjaBrass)
                                .cornerRadius(6)
                                .disabled(codeLoading)
                                if let codeStatus {
                                    Text(codeStatus).font(.system(size: 12, design: .monospaced)).foregroundColor(.forjaEmber)
                                }
                            }

                            if !pending.isEmpty {
                                ForjaCard {
                                    Text("PEDIDOS DE VÍNCULO PENDIENTES")
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundColor(.forjaBrass)
                                    ForEach(pending) { req in
                                        HStack {
                                            Text(req.coach_email).font(.system(size: 13)).foregroundColor(.forjaChalk)
                                            Spacer()
                                            Button("Aceptar") { Task { await accept(req.id) } }
                                                .font(.system(size: 12, weight: .semibold))
                                                .foregroundColor(.forjaBg)
                                                .padding(.horizontal, 10).padding(.vertical, 6)
                                                .background(Color.forjaBrass)
                                                .cornerRadius(5)
                                            Button("Rechazar") { Task { await reject(req.id) } }
                                                .font(.system(size: 12))
                                                .foregroundColor(.forjaSteel)
                                        }
                                        .padding(.vertical, 6)
                                    }
                                }
                            }

                            ForjaCard {
                                Text("VINCULARTE COMO COACH CON UN ATLETA")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(.forjaBrass)
                                HStack(spacing: 8) {
                                    TextField("Código del atleta", text: $linkCode)
                                        .textInputAutocapitalization(.characters)
                                        .padding(8)
                                        .background(Color.forjaPanel2)
                                        .foregroundColor(.forjaChalk)
                                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.forjaLine))
                                        .cornerRadius(6)
                                    Button(linkLoading ? "…" : "Pedir vínculo") { Task { await requestLink() } }
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundColor(.forjaBg)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 10)
                                        .background(linkCode.trimmingCharacters(in: .whitespaces).isEmpty || linkLoading ? Color.forjaBrass.opacity(0.4) : Color.forjaEmber)
                                        .cornerRadius(6)
                                        .disabled(linkCode.trimmingCharacters(in: .whitespaces).isEmpty || linkLoading)
                                }
                                if let linkStatus {
                                    Text(linkStatus).font(.system(size: 12, design: .monospaced)).foregroundColor(.forjaBrass)
                                }
                            }

                            ForjaCard {
                                Text("MIS ATLETAS")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(.forjaBrass)
                                if athletes.isEmpty {
                                    Text("Todavía no tenés atletas vinculados.")
                                        .font(.system(size: 13))
                                        .foregroundColor(.forjaSteel)
                                }
                                ForEach(athletes) { a in
                                    Button {
                                        selectedAthlete = a
                                    } label: {
                                        HStack {
                                            Text(a.athlete_email).font(.system(size: 14)).foregroundColor(.forjaChalk)
                                            Spacer()
                                            VStack(alignment: .trailing, spacing: 2) {
                                                Text(a.adherence_pct != nil ? "\(Int(a.adherence_pct!))% adherencia" : "sin plan")
                                                    .font(.system(size: 11, design: .monospaced))
                                                    .foregroundColor(.forjaSteel)
                                                Text(a.last_check_in != nil ? "último check-in \(a.last_check_in!)" : "sin check-ins")
                                                    .font(.system(size: 10, design: .monospaced))
                                                    .foregroundColor(.forjaSteel)
                                            }
                                        }
                                    }
                                    .padding(.vertical, 8)
                                }
                            }
                        }
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
        async let codeTask = APIClient.shared.getInviteCode()
        async let pendingTask = APIClient.shared.getPendingRequests()
        async let athletesTask = APIClient.shared.getCoachAthletes()
        do {
            let (c, p, a) = try await (codeTask, pendingTask, athletesTask)
            code = c?.code
            pending = p
            athletes = a
        } catch {
            loadError = true
        }
    }

    private func generateCode() async {
        codeLoading = true
        codeStatus = nil
        defer { codeLoading = false }
        do {
            let result = try await APIClient.shared.generateInviteCode()
            code = result.code
        } catch {
            codeStatus = "No se pudo generar el código. Probá de nuevo."
        }
    }

    private func requestLink() async {
        let trimmed = linkCode.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        linkLoading = true
        linkStatus = nil
        defer { linkLoading = false }
        do {
            try await APIClient.shared.requestCoachLink(code: trimmed)
            linkStatus = "Pedido enviado ✓ — cuando el atleta lo acepte vas a verlo en \"Mis atletas\"."
            linkCode = ""
        } catch {
            linkStatus = "No se pudo enviar el pedido. Probá de nuevo."
        }
    }

    private func accept(_ id: Int) async {
        try? await APIClient.shared.acceptLinkRequest(id)
        await loadAll()
    }

    private func reject(_ id: Int) async {
        try? await APIClient.shared.rejectLinkRequest(id)
        await loadAll()
    }
}
