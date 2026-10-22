package com.metus.background

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service + partial wake lock: giữ tiến trình (và CPU) sống khi tool
 * đang chạy hoặc đang chờ chu trình lặp lại, kể cả khi app ở nền / tắt màn hình.
 */
class KeepAliveService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Metus"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    val notification = build(this, title, text)
    val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    if (wakeLock == null) {
      wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "metus:keepalive")
        .apply { setReferenceCounted(false); acquire() }
    }
    running = true
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL_ID = "metus_background"
    private const val NOTIFICATION_ID = 7301
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"

    @Volatile
    var running = false
      private set

    fun start(ctx: Context, title: String, text: String) {
      val i = Intent(ctx, KeepAliveService::class.java).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text)
      ContextCompat.startForegroundService(ctx, i)
    }

    /** Cập nhật nội dung thông báo (không khởi động lại service). */
    fun update(ctx: Context, title: String, text: String) {
      if (!running) return
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.notify(NOTIFICATION_ID, build(ctx, title, text))
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, KeepAliveService::class.java))
    }

    private fun build(ctx: Context, title: String, text: String): Notification {
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
        nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Metus", NotificationManager.IMPORTANCE_LOW))
      }
      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      val pi = launch?.let {
        PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      }
      return NotificationCompat.Builder(ctx, CHANNEL_ID)
        .setSmallIcon(ctx.applicationInfo.icon)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(pi)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .build()
    }
  }
}
