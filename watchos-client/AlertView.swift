import SwiftUI

struct AlertView: View {
    @ObservedObject var manager: AlertManager
    
    // Timer to control flashing frame toggles
    @State private var flashToggle = false
    let flashTimer = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()
    
    var body: some View {
        ZStack {
            // Background Base Theme
            Color.black.ignoresSafeArea()
            
            if manager.licenseStatus != .active {
                // LOCKOUT STATE: LICENSE SUSPENDED
                VStack(spacing: 8) {
                    Image(systemName: "xmark.octagon.fill")
                        .font(.title2)
                        .foregroundColor(.red)
                        .scaleEffect(flashToggle ? 1.1 : 1.0)
                        .animation(.easeInOut(duration: 0.5), value: flashToggle)
                    
                    Text("LICENSE INACTIVE")
                        .font(.system(size: 13, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                    
                    Text(manager.alertMessage)
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundColor(.slateGray)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 4)
                }
                .padding()
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.red.opacity(0.3), lineWidth: 2)
                )
                
            } else if manager.memberStatus == .suspended {
                // LOCKOUT STATE: USER CREDENTIALS REVOKED
                VStack(spacing: 8) {
                    Image(systemName: "lock.shield.fill")
                        .font(.title2)
                        .foregroundColor(.red)
                    
                    Text("ACCESS REVOKED")
                        .font(.system(size: 13, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                    
                    Text("Device Suspended by Administration")
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundColor(.slateGray)
                        .multilineTextAlignment(.center)
                }
                .padding()
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.red.opacity(0.3), lineWidth: 2)
                )
                
            } else {
                
                // --- ACTIVE EVENT ROUTER VIEWS ---
                switch manager.currentStatus {
                    
                case .fireAlarm:
                    // FIRE ALARM: Flashing red background
                    VStack(spacing: 6) {
                        Image(systemName: "flame.fill")
                            .font(.title2)
                            .foregroundColor(.white)
                        
                        Text("FIRE ALARM")
                            .font(.system(size: 18, weight: .black, design: .rounded))
                            .foregroundColor(.white)
                        
                        Text("EVACUATE BUILDING IMMEDIATELY")
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundColor(.white.opacity(0.9))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 2)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(
                        (flashToggle ? Color.red : Color.red.opacity(0.6))
                            .ignoresSafeArea()
                    )
                    
                case .lockdown:
                    // LOCKDOWN: Flashing yellow/dark background
                    VStack(spacing: 6) {
                        Image(systemName: "shield.alert.fill")
                            .font(.title2)
                            .foregroundColor(.black)
                        
                        Text("LOCKDOWN")
                            .font(.system(size: 18, weight: .black, design: .rounded))
                            .foregroundColor(.black)
                        
                        Text("SEEK SECURE AREA. SECURE DOORS.")
                            .font(.system(size: 11, weight: .black, design: .rounded))
                            .foregroundColor(.black.opacity(0.9))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 2)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(
                        (flashToggle ? Color.yellow : Color.yellow.opacity(0.6))
                            .ignoresSafeArea()
                    )
                    
                case .softLockdown:
                    // SOFT LOCKDOWN: Selective routing checks
                    if manager.memberRole == .teacher {
                        // Teachers get calm cyan instructions
                        VStack(spacing: 6) {
                            HStack {
                                Image(systemName: "speaker.slash.fill")
                                    .font(.caption)
                                Text("CORRIDOR ALERT")
                                    .font(.system(size: 10, weight: .black, design: .mono))
                            }
                            .foregroundColor(.cyan)
                            
                            Text("Secure room. Mute hall passes.")
                                .font(.system(size: 13, weight: .black, design: .rounded))
                                .foregroundColor(.white)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 4)
                            
                            Text("Student watches silent.")
                                .font(.system(size: 9, weight: .medium, design: .mono))
                                .foregroundColor(.slateGray)
                        }
                        .padding()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(
                            RoundedRectangle(cornerRadius: 18)
                                .stroke(Color.cyan, lineWidth: 2)
                                .background(Color.cyan.opacity(0.08))
                        )
                    } else {
                        // Students ignore Soft Lockdowns completely (Standby UI rendered)
                        standbyView
                    }
                    
                case .normal:
                    // Normal standby
                    standbyView
                }
            }
        }
        .onReceive(flashTimer) { _ in
            flashToggle.toggle()
        }
    }
    
    // Helper: Standard premium dark standby view
    private var standbyView: some View {
        VStack(spacing: 8) {
            // Pulse Heartbeat dot
            HStack(spacing: 4) {
                Circle()
                    .fill(Color.emeraldGreen)
                    .frame(width: 6, height: 6)
                    .scaleEffect(flashToggle ? 1.4 : 1.0)
                    .animation(.easeInOut(duration: 0.8), value: flashToggle)
                
                Text("ZIP-ALERT ACTIVE")
                    .font(.system(size: 9, weight: .black, design: .mono))
                    .foregroundColor(.slateGray)
            }
            
            Text("Standby")
                .font(.system(size: 18, weight: .black, design: .rounded))
                .foregroundColor(.white)
            
            VStack(spacing: 2) {
                Text(manager.schoolId)
                    .font(.system(size: 9, weight: .semibold, design: .mono))
                    .foregroundColor(.slateGray)
                
                Text("Role: \(manager.memberRole.rawValue.uppercased())")
                    .font(.system(size: 9, weight: .bold, design: .mono))
                    .foregroundColor(.cyan.opacity(0.8))
            }
        }
    }
}

// Extensions for modern colors
extension Color {
    static let slateGray = Color(red: 0.6, green: 0.62, blue: 0.7)
    static let emeraldGreen = Color(red: 0.05, green: 0.85, blue: 0.45)
}
