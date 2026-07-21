import SwiftUI

struct RootTabView: View {
    // .id(identityVersion) fuerza a SwiftUI a recrear las 4 tabs (y por lo
    // tanto sus .task de carga inicial) cuando cambia la identidad — evita que
    // datos de una cuenta/tenant queden mostrados después de un login/logout,
    // el mismo problema que el frontend web resuelve con un reload de página.
    @ObservedObject private var session = AuthSession.shared

    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label("Hoy", systemImage: "flame") }
            PlanningView()
                .tabItem { Label("Planificación", systemImage: "calendar") }
            RoutinesView()
                .tabItem { Label("Rutinas", systemImage: "list.clipboard") }
            ProfileView()
                .tabItem { Label("Perfil", systemImage: "person") }
            BiometricsView()
                .tabItem { Label("Biometría", systemImage: "chart.line.uptrend.xyaxis") }
            CoachView()
                .tabItem { Label("Coach", systemImage: "person.2") }
        }
        .id(session.identityVersion)
        .tint(.forjaEmber)
        .background(Color.forjaBg.ignoresSafeArea())
    }
}
