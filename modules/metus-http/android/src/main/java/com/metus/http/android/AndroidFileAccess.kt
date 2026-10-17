package com.metus.http.android

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.metus.http.core.FileAccess
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.UUID

class AndroidFileAccess(private val context: Context) : FileAccess {
  private val downloadDir = File(context.cacheDir, "metus-downloads").apply { mkdirs() }

  override fun open(uri: String): InputStream {
    val parsed = Uri.parse(uri)
    return when (parsed.scheme) {
      "file", null -> FileInputStream(checkedFile(parsed))
      "content" -> context.contentResolver.openInputStream(parsed)
        ?: throw IllegalArgumentException("Không mở được $uri")
      else -> throw IllegalArgumentException("Scheme không hỗ trợ: ${parsed.scheme}")
    }
  }

  override fun size(uri: String): Long {
    val parsed = Uri.parse(uri)
    return when (parsed.scheme) {
      "file", null -> checkedFile(parsed).length()
      "content" -> context.contentResolver.query(parsed, arrayOf(OpenableColumns.SIZE), null, null, null)
        ?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else -1L } ?: -1L
      else -> -1L
    }
  }

  override fun createDownloadFile(name: String?): File {
    val safe = name?.replace(Regex("[^A-Za-z0-9._-]"), "_")?.take(80)?.ifEmpty { null }
    return File(downloadDir, "${UUID.randomUUID()}-${safe ?: "download.bin"}")
  }

  /**
   * file:// chỉ được đọc trong thư mục cache/files của app — tránh JS đọc
   * file tùy ý rồi upload ra ngoài.
   */
  private fun checkedFile(uri: Uri): File {
    val file = File(uri.path ?: throw IllegalArgumentException("Đường dẫn rỗng")).canonicalFile
    val allowed = listOf(context.cacheDir, context.filesDir).map { it.canonicalPath + File.separator }
    if (allowed.none { file.path.startsWith(it) }) {
      throw SecurityException("Không được đọc file ngoài thư mục app")
    }
    return file
  }
}
