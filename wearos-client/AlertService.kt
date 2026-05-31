package com.zipalert.wearos

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.*
import android.util.Log
import java.util.*

// Enum mapping emergency broadcast states
enum class AlertStatus {
    NORMAL, FIRE_ALARM, LOCKDOWN, SOFT_LOCKDOWN
}

// Enum mapping human roles
enum class MemberRole {
    ADMIN, TEACHER, STUDENT
}

// Enum mapping license states
enum class LicenseStatus {
    ACTIVE, EXPIRED, SUSPENDED
}

class AlertService : Service() {

    private val schoolId = "highland_prep_102"
    private val memberId = "USR-7731" // Mapped active member
    
    private var alertStatus = AlertStatus.NORMAL
    private var memberRole = MemberRole.STUDENT
    private var isMemberActive = true
    private var isLicenseActive = true

    // Billing Prevention & Inactivity Safeguards
    private var lastUserInteraction = System.currentTimeMillis()
    private val idleLimit = 4 * 60 * 60 * 1000L // 4 Hours in milliseconds
    private var isSleeping = false
    private var syncRunnable: Runnable? = null

    private var wakeLock: PowerManager.WakeLock? = null
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    private var vibrationRunnable: Runnable? = null

    // Mock ListenerRegistration types to illustrate compile paths
    private var alertListenerRegistration: Any? = null
    private var memberListenerRegistration: Any? = null

    companion object {
        private const val TAG = "ZipAlert::AlertService"
        private const val CHANNEL_ID = "ZipAlertEmergencyServiceChannel"
        private const val SERVICE_NOTIFICATION_ID = 9021
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Creating emergency broadcast background listener service")
        
        // Initialize hardware controllers
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vibratorManager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

        // Setup Foreground notification channel to protect service from OS purge
        createNotificationChannel()
        startForeground(SERVICE_NOTIFICATION_ID, getServiceNotification("Monitoring alert channels..."))

        // Bind database listeners (Mocking Firebase Firestore Snapshot listeners)
        startFirestoreSync()
    }

    private fun startFirestoreSync() {
        Log.d(TAG, "Binding Firestore snapshot listener: /schools/$schoolId/system_status/current_alert")
        isSleeping = false
        
        // In a standard Android setup:
        /*
        val db = Firebase.firestore
        alertListenerRegistration = db.collection("schools").document(schoolId)
            .collection("system_status").document("current_alert")
            .addSnapshotListener { snapshot, e ->
                if (snapshot != null && snapshot.exists()) {
                    val statusStr = snapshot.getString("status") ?: "NORMAL"
                    val msg = snapshot.getString("message") ?: ""
                    handleAlertUpdate(AlertStatus.valueOf(statusStr), msg)
                }
            }
        */
        
        // Periodic check to mock database sync evaluations and check inactivity timeouts
        syncRunnable = object : Runnable {
            override fun run() {
                val elapsed = System.currentTimeMillis() - lastUserInteraction
                if (alertStatus == AlertStatus.NORMAL && elapsed >= idleLimit) {
                    if (!isSleeping) {
                        stopFirestoreSync()
                    }
                }
                
                if (!isSleeping) {
                    evaluateSensoryFeedback()
                }
                handler.postDelayed(this, 1000)
            }
        }
        handler.postDelayed(syncRunnable!!, 1000)
    }

    private fun stopFirestoreSync() {
        Log.w(TAG, "4 Hours of inactivity exceeded. Disconnecting Firestore snapshot listener. Service sleeping.")
        isSleeping = true
        stopHaptics()
        releaseWakeLock()
        
        // Disconnect real websocket listeners to halt cloud billing reads
        /*
        (alertListenerRegistration as? ListenerRegistration)?.remove()
        alertListenerRegistration = null
        (memberListenerRegistration as? ListenerRegistration)?.remove()
        memberListenerRegistration = null
        */
    }

    // Wake command (called when intent is received from background FCM push broadcast)
    fun wakeSystem() {
        lastUserInteraction = System.currentTimeMillis()
        if (isSleeping) {
            Log.d(TAG, "Wake intent received from FCM. Re-establishing Firestore sockets.")
            startFirestoreSync()
        }
    }

    private fun evaluateSensoryFeedback() {
        // 1. License Check: Silence immediately if District License is suspended/expired
        if (!isLicenseActive) {
            Log.w(TAG, "District License is inactive. Halting sensor feedback.")
            stopHaptics()
            releaseWakeLock()
            return
        }

        // 2. Roster Check: Silence immediately if member status is revoked
        if (!isMemberActive) {
            Log.w(TAG, "User credentials suspended. Revoking device access.")
            stopHaptics()
            releaseWakeLock()
            return
        }

        // 3. Selective Haptic Routing Matrix
        when (alertStatus) {
            AlertStatus.LOCKDOWN, AlertStatus.FIRE_ALARM -> {
                // CRITICAL THREAT: Loops maximum haptic amplitude to bypass silent blocks
                Log.d(TAG, "Lockdown or Fire alarm active. Launching infinite haptic loops.")
                acquireWakeLock()
                startVibrationLoop(intensity = "emergency")
            }
            AlertStatus.SOFT_LOCKDOWN -> {
                // SOFT LOCKDOWN: Muted Corridor operational updates
                if (memberRole == MemberRole.TEACHER) {
                    // Teachers get discrete 3-pulse vibration
                    Log.d(TAG, "Soft Lockdown active for TEACHER. Triggering discrete vibration.")
                    acquireWakeLock()
                    startVibrationLoop(intensity = "discrete")
                } else {
                    // Students remain completely silent (event ignored)
                    Log.d(TAG, "Soft Lockdown ignored for STUDENT. Standby.")
                    stopHaptics()
                }
            }
            AlertStatus.NORMAL -> {
                // Normalize state
                stopHaptics()
                releaseWakeLock()
            }
        }
    }

    private fun startVibrationLoop(intensity: String) {
        stopHaptics()

        if (intensity == "emergency") {
            // High-intensity repeating pattern: 500ms vibrate, 100ms gap at maximum amplitude
            val pattern = longArrayOf(0, 500, 100, 500, 100)
            val amplitudes = intArrayOf(0, 255, 0, 255, 0) // Peak amplitude 255

            vibrationRunnable = object : Runnable {
                override fun run() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator?.vibrate(VibrationEffect.createWaveform(pattern, amplitudes, -1))
                    } else {
                        @Suppress("DEPRECATION")
                        vibrator?.vibrate(pattern, -1)
                    }
                    handler.postDelayed(this, 1200) // Repeat every 1.2s
                }
            }
            handler.post(vibrationRunnable!!)
        } else {
            // Discrete 3-pulse haptic waveform (non-repeating) for teachers
            val pattern = longArrayOf(0, 200, 100, 200, 100, 200)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, -1))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, -1)
            }
        }
    }

    private fun stopHaptics() {
        vibrationRunnable?.let { handler.removeCallbacks(it) }
        vibrationRunnable = null
        vibrator?.cancel()
    }

    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "ZipAlert::CrisisWakeLock"
            )
            wakeLock?.acquire(10 * 60 * 1000L) // 10 minutes max timeout
            Log.d(TAG, "PowerManager WakeLock acquired. CPU/Screen locked active.")
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d(TAG, "PowerManager WakeLock released.")
            }
        }
        wakeLock = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "ZipAlert background channels",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(serviceChannel)
        }
    }

    private fun getServiceNotification(text: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle("ZipAlert Safeguard")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .build()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // If an FCM wake intent is captured, wake the system immediately
        intent?.let {
            if (it.getBooleanExtra("fcm_wake", false)) {
                wakeSystem()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        stopFirestoreSync()
        syncRunnable?.let { handler.removeCallbacks(it) }
        syncRunnable = null
        Log.d(TAG, "Service destroyed. Active haptic listeners and background timers cleared.")
    }
}
