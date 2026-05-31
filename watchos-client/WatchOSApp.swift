import SwiftUI

@main
struct WatchOSApp: App {
    // Instantiates the lifecycle coordinator
    @StateObject private var alertManager = AlertManager()
    
    @SceneBuilder var body: some Scene {
        WindowGroup {
            NavigationView {
                AlertView(manager: alertManager)
            }
        }
    }
}
