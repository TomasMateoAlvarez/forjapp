import Foundation
import Combine

// Estado de sesión compartido por toda la app. `identityVersion` se usa como
// `.id()` en RootTabView para forzar que las 4 tabs se recreen (y por lo tanto
// vuelvan a pedir sus datos) cuando cambia la identidad — equivalente nativo
// del `window.location.reload()` que usa el frontend web para el mismo
// problema (evitar datos de otra cuenta/tenant quedando cacheados en memoria).
final class AuthSession: ObservableObject {
    static let shared = AuthSession()

    private let tokenKey = "auth_token"
    private let userKey = "auth_user"

    @Published private(set) var user: AuthUser?
    @Published private(set) var identityVersion: Int = 0

    var token: String? { KeychainStore.get(forKey: tokenKey) }

    private init() {
        if let raw = KeychainStore.get(forKey: userKey), let data = raw.data(using: .utf8) {
            user = try? JSONDecoder().decode(AuthUser.self, from: data)
        }
    }

    func save(token: String, user: AuthUser) {
        KeychainStore.set(token, forKey: tokenKey)
        if let data = try? JSONEncoder().encode(user), let str = String(data: data, encoding: .utf8) {
            KeychainStore.set(str, forKey: userKey)
        }
        self.user = user
        identityVersion += 1
    }

    func clear() {
        KeychainStore.delete(forKey: tokenKey)
        KeychainStore.delete(forKey: userKey)
        user = nil
        identityVersion += 1
    }
}
