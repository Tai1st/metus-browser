package com.metus.http.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import com.metus.http.core.AccountCookieJar
import java.io.File
import java.security.KeyStore
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Kho cookie jar theo tài khoản, lưu file mã hóa AES-GCM bằng khóa trong
 * Android Keystore (khóa không rời phần cứng/TEE, không export được).
 */
class AccountStore(context: Context) {
  private val dir = File(context.filesDir, "metus-accounts").apply { mkdirs() }
  private val jars = ConcurrentHashMap<String, AccountCookieJar>()
  private val saver = Executors.newSingleThreadScheduledExecutor()
  private val pending = ConcurrentHashMap<String, ScheduledFuture<*>>()

  init {
    dir.listFiles { f -> f.name.endsWith(".bin") }?.forEach { f ->
      try {
        val jar = AccountCookieJar.fromJson(String(decrypt(f.readBytes()), Charsets.UTF_8), onChanged = ::scheduleSave)
        jars[jar.id] = jar
      } catch (e: Exception) {
        // Không log nội dung — chỉ log tên file.
        Log.w(TAG, "Bỏ qua file tài khoản hỏng: ${f.name}")
      }
    }
  }

  fun get(id: String): AccountCookieJar? = jars[id]

  fun ids(): List<String> = jars.keys().toList().sorted()

  fun getOrCreate(id: String): AccountCookieJar =
    jars.getOrPut(id) { AccountCookieJar(id, onChanged = ::scheduleSave) }

  /** Thay toàn bộ jar (dùng khi nhập lại cookie cho cùng tài khoản). */
  fun replace(id: String): AccountCookieJar {
    val jar = AccountCookieJar(id, onChanged = ::scheduleSave)
    jars[id] = jar
    return jar
  }

  fun remove(id: String) {
    jars.remove(id)
    pending.remove(id)?.cancel(false)
    fileFor(id).delete()
  }

  private fun scheduleSave(jar: AccountCookieJar) {
    pending[jar.id]?.cancel(false)
    pending[jar.id] = saver.schedule({ save(jar) }, 500, TimeUnit.MILLISECONDS)
  }

  private fun save(jar: AccountCookieJar) {
    if (jars[jar.id] !== jar) return
    try {
      val tmp = File(dir, "${safeName(jar.id)}.tmp")
      tmp.writeBytes(encrypt(jar.toJson().toByteArray(Charsets.UTF_8)))
      tmp.renameTo(fileFor(jar.id))
    } catch (e: Exception) {
      Log.w(TAG, "Lưu tài khoản thất bại: ${e.javaClass.simpleName}")
    }
  }

  private fun fileFor(id: String) = File(dir, "${safeName(id)}.bin")

  private fun safeName(id: String) = id.replace(Regex("[^A-Za-z0-9_-]"), "_")

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return gen.generateKey()
  }

  private fun encrypt(plain: ByteArray): ByteArray {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    return cipher.iv + cipher.doFinal(plain)
  }

  private fun decrypt(data: ByteArray): ByteArray {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data, 0, IV_LEN))
    return cipher.doFinal(data, IV_LEN, data.size - IV_LEN)
  }

  companion object {
    private const val TAG = "MetusAccountStore"
    private const val KEY_ALIAS = "metus_accounts_v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_LEN = 12
  }
}
