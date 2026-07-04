import SwiftUI

struct RootTabView: View {
    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label("Hoy", systemImage: "flame") }
            PlanningView()
                .tabItem { Label("Planificación", systemImage: "calendar") }
            RoutinesView()
                .tabItem { Label("Rutinas", systemImage: "list.clipboard") }
            BiometricsView()
                .tabItem { Label("Perfil", systemImage: "person") }
        }
        .tint(.forjaEmber)
        .background(Color.forjaBg.ignoresSafeArea())
    }
}
