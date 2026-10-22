package com.metus.background

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Chạy nền cho tool (chu trình lặp lại):
 * - start/stop: foreground service + wake lock (KeepAliveService)
 * - headless JS task "MetusKeepAlive" → React Native không dừng timer JS khi app ở nền
 * - sleep(ms): chờ bằng Handler native (không phụ thuộc nhịp vẽ màn hình như setTimeout),
 *   nên vẫn chạy khi tắt màn hình.
 */
class MetusBackgroundModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var taskId: Int? = null

  private val context get() = appContext.reactContext ?: throw IllegalStateException("React context chưa sẵn sàng")

  override fun definition() = ModuleDefinition {
    Name("MetusBackground")

    AsyncFunction("start") { title: String, text: String ->
      KeepAliveService.start(context, title, text)
      startHeadlessTask()
    }

    AsyncFunction("update") { title: String, text: String ->
      KeepAliveService.update(context, title, text)
    }

    AsyncFunction("stop") {
      finishHeadlessTask()
      KeepAliveService.stop(context)
    }

    Function("isRunning") { KeepAliveService.running }

    AsyncFunction("sleep") { ms: Double, promise: Promise ->
      handler.postDelayed({ promise.resolve(null) }, ms.toLong().coerceAtLeast(0))
    }

    OnDestroy {
      finishHeadlessTask()
    }
  }

  private fun startHeadlessTask() {
    val rc = context as? ReactContext ?: return
    UiThreadUtil.runOnUiThread {
      if (taskId != null) return@runOnUiThread
      try {
        taskId = HeadlessJsTaskContext.getInstance(rc)
          .startTask(HeadlessJsTaskConfig("MetusKeepAlive", Arguments.createMap(), 0, true))
      } catch (_: Throwable) {
        taskId = null
      }
    }
  }

  private fun finishHeadlessTask() {
    val rc = appContext.reactContext as? ReactContext ?: return
    UiThreadUtil.runOnUiThread {
      taskId?.let { id ->
        try {
          HeadlessJsTaskContext.getInstance(rc).finishTask(id)
        } catch (_: Throwable) {
        }
      }
      taskId = null
    }
  }
}
