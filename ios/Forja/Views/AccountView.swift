import SwiftUI

// Cuenta opcional (ver AccountPanel.tsx en el frontend web para el mismo
// razonamiento): hoy los datos ya se guardan por client_id anónimo en este
// dispositivo y eso sigue funcionando igual. Crear una cuenta no migra ese
// historial anónimo — abre un espacio nuevo y aislado bajo el usuario.
struct AccountView: View {
    @ObservedObject private var session = AuthSession.shared

    @State private var isRegisterMode = false
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var isLoading = false

    var body: some View {
        ForjaCard {
            if let user = session.user {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("SESIÓN").font(.system(size: 9, design: .monospaced)).foregroundColor(.forjaSteel)
                        Text(user.email).font(.system(size: 14)).foregroundColor(.forjaChalk)
                    }
                    Spacer()
                    Button("Cerrar sesión") { Task { await logout() } }
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(.forjaBrass)
                }
            } else {
                Text("CUENTA — \(isRegisterMode ? "CREAR CUENTA" : "INICIAR SESIÓN")")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(.forjaBrass)

                Text("Opcional: tus datos ya se guardan en este dispositivo sin necesidad de cuenta. Crear una cuenta migra ese historial a la cuenta nueva. Si en cambio iniciás sesión en una cuenta existente, el historial de este dispositivo no se mezcla automáticamente.")
                    .font(.system(size: 12))
                    .foregroundColor(.forjaSteel)

                TextField("Email", text: $email)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    .padding(8)
                    .background(Color.forjaPanel2)
                    .foregroundColor(.forjaChalk)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.forjaLine))
                    .cornerRadius(6)

                SecureField("Contraseña (mín. 8 caracteres)", text: $password)
                    .padding(8)
                    .background(Color.forjaPanel2)
                    .foregroundColor(.forjaChalk)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.forjaLine))
                    .cornerRadius(6)

                if let error {
                    Text(error).font(.system(size: 12, design: .monospaced)).foregroundColor(.forjaEmber)
                }

                HStack(spacing: 8) {
                    Button(isLoading ? "…" : (isRegisterMode ? "Crear cuenta" : "Entrar")) {
                        Task { await submit() }
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.forjaBg)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(email.isEmpty || password.count < 8 || isLoading ? Color.forjaBrass.opacity(0.4) : Color.forjaEmber)
                    .cornerRadius(6)
                    .disabled(email.isEmpty || password.count < 8 || isLoading)

                    Button(isRegisterMode ? "Ya tengo cuenta" : "Crear cuenta nueva") {
                        isRegisterMode.toggle()
                        error = nil
                    }
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(.forjaBrass)
                }
            }
        }
    }

    private func submit() async {
        error = nil
        isLoading = true
        defer { isLoading = false }
        do {
            let result = isRegisterMode
                ? try await APIClient.shared.register(email: email, password: password)
                : try await APIClient.shared.login(email: email, password: password)
            if isRegisterMode {
                try? await APIClient.shared.migrateAnonymousData(token: result.token, anonymousClientId: ClientIdentity.current)
            }
            session.save(token: result.token, user: result.user)
            email = ""; password = ""
        } catch {
            self.error = isRegisterMode
                ? "No se pudo crear la cuenta (¿ya existe ese email? ¿contraseña de al menos 8 caracteres?)."
                : "Email o contraseña incorrectos."
        }
    }

    private func logout() async {
        try? await APIClient.shared.logout()
        session.clear()
    }
}
