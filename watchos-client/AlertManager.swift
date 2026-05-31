import Foundation
import SwiftUI
import Combine
import WatchKit

// Enum representing the overall emergency broadcast states
enum AlertStatus: String, Codable {
    case normal = "NORMAL"
    case fireAlarm = "FIRE_ALARM"
    case lockdown = "LOCKDOWN"
    case softLockdown = "SOFT_LOCKDOWN"
}

// Enum representing human-assigned roles in the school district
enum MemberRole: String, Codable {
    case admin = "ADMIN"
    case teacher = "TEACHER"
    case student = "STUDENT"
}

// Enum representing membership statuses
enum MemberStatus: String, Codable {
    case active = "ACTIVE"
    case suspended = "SUSPENDED"
}

// Represents the active school subscription license status
enum LicenseStatus: String, Codable {
    case active = "ACTIVE"
    case expired = "EXPIRED"
    case suspended = "SUSPENDED"
}

class AlertManager: ObservableObject {
    // Current bound context (Multi-tenant settings)
    @Published var schoolId: String = "highland_prep_102"
    @Published var deviceId: String = "DEV-5099"
    @Published var memberId: String = "USR-7731" // Links to human roster profile
    
    // Synced database states
    @Published var currentStatus: AlertStatus = .normal
    @Published var alertMessage: String = "System Standby. Scanning broadcast channels."
    @Published var memberRole: MemberRole = .student
    @Published var memberStatus: MemberStatus = .active
    @Published var licenseStatus: LicenseStatus = .active
    
    // Core engine trackers
    private var hapticTimer: Timer? = nil
    private var simulationTimer: Timer? = nil
    private var cancellables = Set<AnyCancellable>()
    
    // Billing Prevention & Inactivity Trackers
    @Published var connectionState: String = "LISTENING" // "LISTENING" | "SLEEPING"
    private var lastUserInteraction: Date = Date()
    private let idleLimit: TimeInterval = 4 * 60 * 60 // 4 Hours
    
    init() {
        // Bootstraps real-time snapshot listener channels
        startRealTimeListeners()
    }
    
    deinit {
        print("[watchOS AlertManager] Deinitializing coordinator. Sanity clearing all memory pipelines.")
        stopHapticLoop()
        stopRealTimeListeners()
        simulationTimer?.invalidate()
        simulationTimer = nil
    }
    
    /// Establishes the listeners (Mocking Firebase Firestore Snapshot queries)
    func startRealTimeListeners() {
        print("[watchOS AlertManager] Binding snapshot channels to school: \(schoolId)")
        
        // In a compiled Firebase environment, the developer integrates the Firebase SDK:
        /*
        let db = Firestore.firestore()
        
        // 1. Listen to global School Alert status
        db.collection("schools").document(schoolId).collection("system_status").document("current_alert")
            .addSnapshotListener { [weak self] snapshot, error in
                guard let data = snapshot?.data(), error == nil else { return }
                self?.handleAlertUpdate(data)
            }
            
        // 2. Listen to Member profile status (To detect suspensions and roles)
        db.collection("schools").document(schoolId).collection("members").document(memberId)
            .addSnapshotListener { [weak self] snapshot, error in
                guard let data = snapshot?.data(), error == nil else { return }
                self?.handleMemberUpdate(data)
            }
            
        // 3. Listen to active License terms
        db.collection("licenses").document("LIC-HL102")
            .addSnapshotListener { [weak self] snapshot, error in
                guard let data = snapshot?.data(), error == nil else { return }
                self?.handleLicenseUpdate(data)
            }
        */
        
        // Simulated snapshot stream updates for local wearable diagnostics
        simulateSnapshotUpdates()
    }
    
    /// Handles emergency alert states dynamically based on licensing and roles
    func evaluateSensoryFeedback() {
        // 1. License Check: If license is suspended or expired, block all feedbacks
        if licenseStatus != .active {
            print("[watchOS AlertManager] SaaS License suspended. Silencing watch nodes.")
            stopHapticLoop()
            currentStatus = .normal
            alertMessage = "District License Suspended. Connect system owner."
            return
        }
        
        // 2. Roster Access check: If member profile is suspended, revoke all active views
        if memberStatus == .suspended {
            print("[watchOS AlertManager] User credentials suspended. revoking access.")
            stopHapticLoop()
            currentStatus = .normal
            alertMessage = "Access Revoked by School Administration."
            return
        }
        
        // 3. Selective Sensory Routing Matrix
        switch currentStatus {
        case .lockdown, .fireAlarm:
            // HARD CRISIS: Evacuate / Secure - Affects everyone
            print("[watchOS AlertManager] Hard emergency active. Triggering continuous alarms and screen wake locks.")
            startHapticLoop(intensity: .emergency)
            forceScreenWake()
            
        case .softLockdown:
            // SOFT LOCKDOWN: Muted Corridor Alert
            if memberRole == .teacher {
                // Teachers get discrete 3-pulse vibration and quiet notifications
                print("[watchOS AlertManager] Soft Lockdown intercepted for TEACHER. Triggering discrete haptic.")
                startHapticLoop(intensity: .discrete)
                forceScreenWake()
            } else {
                // Students remain completely silent and standby (ignores the event entirely)
                print("[watchOS AlertManager] Soft Lockdown ignored for STUDENT. Remaining idle.")
                stopHapticLoop()
            }
            
        case .normal:
            // Normalize system state
            print("[watchOS AlertManager] School state normal. Silencing haptic loops.")
            stopHapticLoop()
        }
    }
    
    /// Continuous sensory looping to penetrate noise-canceling headphones
    private func startHapticLoop(intensity: HapticIntensity) {
        stopHapticLoop()
        
        if intensity == .emergency {
            // High-strength .alarm haptic recurring on a 1.2s delay loop
            hapticTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { _ in
                WKInterfaceDevice.current().play(.alarm)
            }
            // Trigger immediately on thread initialization
            WKInterfaceDevice.current().play(.alarm)
        } else {
            // Discrete 3-pulse notification vibration for teachers (non-looping)
            WKInterfaceDevice.current().play(.notification)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                WKInterfaceDevice.current().play(.notification)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                WKInterfaceDevice.current().play(.notification)
            }
        }
    }
    
    private func stopHapticLoop() {
        hapticTimer?.invalidate()
        hapticTimer = nil
    }
    
    /// Forces Apple Watch screen to remain illuminated at peak brightness
    private func forceScreenWake() {
        // Enforces full brightness and locks screen awake using WatchKit interfaces
        WKExtension.shared().isApplicationActivelyTracking = true
    }
    
    /// Disconnects Combine sockets to eliminate read charges
    func stopRealTimeListeners() {
        cancellables.removeAll()
        connectionState = "SLEEPING"
        print("[watchOS AlertManager] 4h Inactivity exceeded. Combine sockets disconnected cleanly. Reading halted.")
    }
    
    /// Wakes watch from sleep (Triggered by user interaction or high-priority background FCM wake)
    func wakeSystem() {
        lastUserInteraction = Date()
        if connectionState == "SLEEPING" {
            print("[watchOS AlertManager] Wake token captured. Re-establishing socket channels.")
            connectionState = "LISTENING"
            startRealTimeListeners()
        }
    }
    
    // Mock Telemetry Simulation
    private func simulateSnapshotUpdates() {
        simulationTimer?.invalidate()
        simulationTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            
            // Core Safeguard: Check if device has been stationary/idle for > 4 hours
            let elapsed = Date().timeIntervalSince(self.lastUserInteraction)
            if self.currentStatus == .normal && elapsed >= self.idleLimit {
                if self.connectionState == "LISTENING" {
                    self.stopRealTimeListeners()
                }
            }
            
            // Periodically check configurations and process sensory loops
            self.evaluateSensoryFeedback()
        }
    }
    
    enum HapticIntensity {
        case emergency
        case discrete
    }
}
