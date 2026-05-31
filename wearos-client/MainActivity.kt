package com.zipalert.wearos

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Start AlertService background listeners
        val serviceIntent = Intent(this, AlertService::class.java)
        startService(serviceIntent)

        setContent {
            WearApp()
        }
    }

    @Composable
    fun WearApp() {
        // Mocking bound states that map to AlertService's real-time snapshot engines
        var alertStatus by remember { mutableStateOf(AlertStatus.NORMAL) }
        var memberRole by remember { mutableStateOf(MemberRole.STUDENT) }
        var isMemberActive by remember { mutableStateOf(true) }
        var isLicenseActive by remember { mutableStateOf(true) }
        var alertMessage by remember { mutableStateOf("SEEK SECURE AREA IMMEDIATELY. SECURE CORRIDOR DOORS.") }

        // Animation drivers for emergency flashing visual blocks
        var flashToggle by remember { mutableStateOf(false) }
        LaunchedEffect(alertStatus) {
            if (alertStatus == AlertStatus.LOCKDOWN || alertStatus == AlertStatus.FIRE_ALARM) {
                while (true) {
                    flashToggle = !flashToggle
                    delay(500)
                }
            }
        }

        // Animated Pulse heartbeat dot for Standby State
        val infiniteTransition = rememberInfiniteTransition(label = "pulse")
        val pulseScale by infiniteTransition.animateFloat(
            initialValue = 0.8f,
            targetValue = 1.3f,
            animationSpec = infiniteRepeatable(
                animation = tween(1000, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            ),
            label = "pulseScale"
        )

        // Forces screen awake using layout parameters if an alert is active
        val hasCrisis = alertStatus != AlertStatus.NORMAL
        LaunchedEffect(hasCrisis) {
            if (hasCrisis && isLicenseActive && isMemberActive) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .padding(12.dp),
            contentAlignment = Alignment.Center
        ) {
            if (!isLicenseActive) {
                // LICENSE SUSPENDED STATE
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier
                        .fillMaxSize()
                        .border(2.dp, Color.Red, RoundedCornerShape(18.dp))
                        .padding(8.dp)
                ) {
                    Text(
                        text = "LICENSE INACTIVE",
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Black,
                        fontFamily = FontFamily.Monospace
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "School subscription suspended.",
                        color = Color.Gray,
                        fontSize = 9.sp,
                        textAlign = TextAlign.Center
                    )
                }
            } else if (!isMemberActive) {
                // ACCOUNT SUSPENDED STATE
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier
                        .fillMaxSize()
                        .border(2.dp, Color.Red, RoundedCornerShape(18.dp))
                        .padding(8.dp)
                ) {
                    Text(
                        text = "ACCESS REVOKED",
                        color = Color.Red,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Black
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Device suspended by admin.",
                        color = Color.Gray,
                        fontSize = 9.sp,
                        textAlign = TextAlign.Center
                    )
                }
            } else {
                // --- ACTIVE SCENE ROUTER ---
                when (alertStatus) {
                    AlertStatus.FIRE_ALARM -> {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(if (flashToggle) Color(0xFFEF4444) else Color(0xFF7F1D1D)),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = "FIRE ALARM",
                                    color = Color.White,
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.Black,
                                    textAlign = TextAlign.Center
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "EVACUATE BUILDING NOW",
                                    color = Color.White,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    textAlign = TextAlign.Center
                                )
                            }
                        }
                    }
                    AlertStatus.LOCKDOWN -> {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(if (flashToggle) Color(0xFFEAB308) else Color(0xFF713F12)),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = "LOCKDOWN",
                                    color = Color.Black,
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.Black,
                                    textAlign = TextAlign.Center
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = alertMessage,
                                    color = Color.Black,
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Black,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.padding(horizontal = 4.dp)
                                )
                            }
                        }
                    }
                    AlertStatus.SOFT_LOCKDOWN -> {
                        if (memberRole == MemberRole.TEACHER) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .border(2.dp, Color(0xFF06B6D4), RoundedCornerShape(20.dp))
                                    .background(Color(0xFF06B6D4).copy(alpha = 0.08f))
                                    .padding(8.dp)
                            ) {
                                Text(
                                    text = "CORRIDOR ALERT",
                                    color = Color(0xFF06B6D4),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Black,
                                    fontFamily = FontFamily.Monospace
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "Muted Lockdown: Secure room. Mute hall passes.",
                                    color = Color.White,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    textAlign = TextAlign.Center
                                )
                            }
                        } else {
                            StandbyView(memberRole, pulseScale)
                        }
                    }
                    AlertStatus.NORMAL -> {
                        StandbyView(memberRole, pulseScale)
                    }
                }
            }
        }
    }

    @Composable
    fun StandbyView(role: MemberRole, pulseScale: Float) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                Box(
                    modifier = Modifier
                        .size((6 * pulseScale).dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(Color(0xFF10B981))
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "SAFEGUARD ACTIVE",
                    color = Color.Gray,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "Standby",
                color = Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.Black
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = "Role: ${role.name}",
                color = Color(0xFF06B6D4).copy(alpha = 0.8f),
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold
            )
        }
    }
}
