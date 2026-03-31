package com.trendmicro.boothapp.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.animation.AnimationUtils
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.trendmicro.boothapp.R
import com.trendmicro.boothapp.camera.CameraManager
import com.trendmicro.boothapp.data.AppPreferences
import com.trendmicro.boothapp.data.S3Uploader
import com.trendmicro.boothapp.data.SessionApi
import com.trendmicro.boothapp.databinding.ActivityMainBinding
import com.trendmicro.boothapp.ocr.BadgeOcrProcessor
import kotlinx.coroutines.launch
import java.io.File

/**
 * Main screen: camera preview, badge capture, OCR extraction, session start/end.
 *
 * Flow:
 * 1. SE points camera at visitor badge -> taps Capture
 * 2. ML Kit extracts name/company -> fills text fields
 * 3. SE taps Start Session -> calls orchestrator, uploads badge to S3
 * 4. Demo runs...
 * 5. SE taps End Session -> calls orchestrator end endpoint
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: AppPreferences
    private lateinit var cameraManager: CameraManager
    private lateinit var ocrProcessor: BadgeOcrProcessor

    private var capturedBadgeFile: File? = null
    private var capturedBitmap: Bitmap? = null
    private var activeSessionId: String? = null
    private var activeDemoPc: String? = null
    private var sessionStartTime: Long = 0L
    private val timerHandler = Handler(Looper.getMainLooper())
    private val timerRunnable = object : Runnable {
        override fun run() {
            val elapsed = SystemClock.elapsedRealtime() - sessionStartTime
            val minutes = (elapsed / 60000).toInt()
            val seconds = ((elapsed % 60000) / 1000).toInt()
            binding.tvDuration.text = String.format("%d:%02d", minutes, seconds)
            timerHandler.postDelayed(this, 1000)
        }
    }

    private val qrScanLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val paired = result.data?.getBooleanExtra(QrScanActivity.EXTRA_PAIRED, false) ?: false
            if (paired) {
                toast(getString(R.string.paired_success))
                // Refresh defaults from newly saved prefs
                binding.etDemoPc.setText(prefs.defaultDemoPc)
                binding.etSeName.setText(prefs.defaultSeName)
            }
        }
    }

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            startCameraPreview()
        } else {
            Toast.makeText(this, R.string.camera_permission_required, Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = AppPreferences(this)
        cameraManager = CameraManager(this)
        ocrProcessor = BadgeOcrProcessor()

        setupUI()
        checkCameraPermission()
    }

    private fun setupUI() {
        // Pre-fill defaults from settings
        binding.etDemoPc.setText(prefs.defaultDemoPc)
        binding.etSeName.setText(prefs.defaultSeName)

        binding.btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        binding.btnScanQr.setOnClickListener {
            qrScanLauncher.launch(Intent(this, QrScanActivity::class.java))
        }

        binding.btnCapture.setOnClickListener {
            if (capturedBadgeFile != null) {
                retakePhoto()
            } else {
                capturePhoto()
            }
        }
        binding.btnStartSession.setOnClickListener { startSession() }
        binding.btnEndSession.setOnClickListener { confirmEndSession() }
    }

    override fun onResume() {
        super.onResume()
        // Refresh defaults in case settings changed
        if (binding.etDemoPc.text.isNullOrBlank()) {
            binding.etDemoPc.setText(prefs.defaultDemoPc)
        }
        if (binding.etSeName.text.isNullOrBlank()) {
            binding.etSeName.setText(prefs.defaultSeName)
        }
    }

    private fun checkCameraPermission() {
        when {
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED -> startCameraPreview()
            else -> cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startCameraPreview() {
        binding.previewView.visibility = View.VISIBLE
        binding.ivCapturedBadge.visibility = View.GONE
        binding.tvCameraHint.visibility = View.VISIBLE
        cameraManager.startCamera(binding.previewView, this)
    }

    private fun retakePhoto() {
        capturedBadgeFile = null
        capturedBitmap = null
        binding.etVisitorName.text?.clear()
        binding.etVisitorCompany.text?.clear()
        binding.btnStartSession.isEnabled = false
        binding.btnCapture.text = getString(R.string.capture_badge)
        startCameraPreview()
    }

    private fun capturePhoto() {
        showProgress(true)
        binding.tvCameraHint.text = getString(R.string.ocr_extracting)

        cameraManager.capturePhoto(object : CameraManager.CaptureCallback {
            override fun onCaptured(bitmap: Bitmap, file: File) {
                capturedBitmap = bitmap
                capturedBadgeFile = file

                // Show captured image
                binding.previewView.visibility = View.GONE
                binding.ivCapturedBadge.visibility = View.VISIBLE
                binding.ivCapturedBadge.setImageBitmap(bitmap)
                binding.tvCameraHint.text = getString(R.string.ocr_extracting)

                // Run OCR
                lifecycleScope.launch {
                    val info = ocrProcessor.process(bitmap)
                    Log.d(TAG, "OCR result: name='${info.name}' company='${info.company}'")

                    binding.etVisitorName.setText(info.name)
                    binding.etVisitorCompany.setText(info.company)

                    showProgress(false)
                    binding.tvCameraHint.visibility = View.GONE
                    binding.btnStartSession.isEnabled = true

                    // Change capture to retake
                    binding.btnCapture.text = getString(R.string.retake)

                    // Auto-start session if we got a valid name and orchestrator is configured
                    if (info.name.isNotBlank() && prefs.orchestratorUrl.isNotBlank()) {
                        Log.d(TAG, "Auto-starting session for: ${info.name}")
                        toast(getString(R.string.auto_starting_session))
                        startSession()
                    }
                }
            }

            override fun onError(message: String) {
                showProgress(false)
                toast("Capture error: $message")
            }
        })
    }

    private fun startSession() {
        val url = prefs.orchestratorUrl
        if (url.isBlank()) {
            toast(getString(R.string.error_no_url))
            return
        }

        val visitorName = binding.etVisitorName.text?.toString()?.trim() ?: ""
        val visitorCompany = binding.etVisitorCompany.text?.toString()?.trim()
        val demoPc = binding.etDemoPc.text?.toString()?.trim() ?: "booth-pc-1"
        val seName = binding.etSeName.text?.toString()?.trim()

        if (visitorName.isBlank()) {
            toast("Enter visitor name")
            return
        }

        showProgress(true)
        binding.btnStartSession.isEnabled = false

        lifecycleScope.launch {
            val api = SessionApi(url)
            val request = SessionApi.CreateSessionRequest(
                visitorName = visitorName,
                visitorCompany = visitorCompany,
                badgePhoto = "badge.jpg",
                demoPc = demoPc,
                seName = seName,
                audioConsent = true
            )

            val result = api.createSession(request)

            result.onSuccess { response ->
                activeSessionId = response.sessionId
                activeDemoPc = demoPc

                // Upload badge photo and metadata to S3
                uploadBadgePhoto(response.sessionId)
                uploadMetadata(response.sessionId, visitorName, visitorCompany, demoPc, seName)

                // Update UI to active session state
                binding.tvStatus.text = getString(R.string.session_active)
                binding.tvStatus.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.tm_green))
                binding.tvSessionId.text = "Session: ${response.sessionId}"
                binding.tvSessionId.visibility = View.VISIBLE
                val displayInfo = if (!visitorCompany.isNullOrBlank()) "$visitorName - $visitorCompany" else visitorName
                binding.tvVisitorInfo.text = displayInfo
                binding.tvVisitorInfo.visibility = View.VISIBLE

                // Start session timer
                sessionStartTime = SystemClock.elapsedRealtime()
                binding.tvDuration.visibility = View.VISIBLE
                binding.tvDuration.text = "0:00"
                timerHandler.post(timerRunnable)

                // Swap buttons
                binding.btnCapture.visibility = View.GONE
                binding.btnStartSession.visibility = View.GONE
                binding.btnEndSession.visibility = View.VISIBLE
                binding.btnEndSession.isEnabled = true

                showProgress(false)
                toast(getString(R.string.session_created, response.sessionId))
            }

            result.onFailure { e ->
                showProgress(false)
                binding.btnStartSession.isEnabled = true
                toast(getString(R.string.error_session, e.message))
            }
        }
    }

    private fun uploadBadgePhoto(sessionId: String) {
        val file = capturedBadgeFile ?: return

        if (!prefs.hasAwsCredentials()) {
            Log.w(TAG, "No AWS credentials configured, skipping S3 upload")
            return
        }

        lifecycleScope.launch {
            try {
                val uploader = S3Uploader(
                    accessKeyId = prefs.awsAccessKeyId,
                    secretAccessKey = prefs.awsSecretAccessKey
                )
                val uploadResult = uploader.uploadBadge(sessionId, file)
                uploadResult.onSuccess {
                    Log.d(TAG, "Badge uploaded to S3: $it")
                }
                uploadResult.onFailure { e ->
                    Log.e(TAG, "Badge upload failed", e)
                    toast("Badge upload failed: ${e.message}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "S3 uploader init failed", e)
            }
        }
    }

    private fun uploadMetadata(
        sessionId: String,
        visitorName: String,
        visitorCompany: String?,
        demoPc: String,
        seName: String?
    ) {
        if (!prefs.hasAwsCredentials()) return

        lifecycleScope.launch {
            try {
                val uploader = S3Uploader(
                    accessKeyId = prefs.awsAccessKeyId,
                    secretAccessKey = prefs.awsSecretAccessKey
                )
                val result = uploader.uploadMetadata(
                    sessionId = sessionId,
                    visitorName = visitorName,
                    visitorCompany = visitorCompany,
                    demoPc = demoPc,
                    seName = seName,
                    audioConsent = true
                )
                result.onSuccess { Log.d(TAG, "Metadata uploaded: $it") }
                result.onFailure { e -> Log.e(TAG, "Metadata upload failed", e) }
            } catch (e: Exception) {
                Log.e(TAG, "Metadata upload init failed", e)
            }
        }
    }

    private fun confirmEndSession() {
        AlertDialog.Builder(this)
            .setTitle(R.string.end_session_confirm_title)
            .setMessage(R.string.end_session_confirm_message)
            .setPositiveButton(R.string.confirm) { _, _ -> endSession() }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun endSession() {
        val url = prefs.orchestratorUrl
        val sessionId = activeSessionId
        if (url.isBlank() || sessionId == null) return

        showProgress(true)
        binding.btnEndSession.isEnabled = false

        lifecycleScope.launch {
            val api = SessionApi(url)
            val result = api.endSession(sessionId, activeDemoPc)

            result.onSuccess {
                toast(getString(R.string.session_ended))
                resetToIdle()
            }

            result.onFailure { e ->
                showProgress(false)
                binding.btnEndSession.isEnabled = true
                toast(getString(R.string.error_session, e.message))
            }
        }
    }

    private fun resetToIdle() {
        timerHandler.removeCallbacks(timerRunnable)
        activeSessionId = null
        activeDemoPc = null
        capturedBadgeFile = null
        capturedBitmap = null

        binding.tvStatus.text = getString(R.string.no_session)
        binding.tvStatus.setTextColor(ContextCompat.getColor(this, R.color.tm_text_secondary))
        binding.tvSessionId.visibility = View.GONE
        binding.tvVisitorInfo.visibility = View.GONE
        binding.tvDuration.visibility = View.GONE

        binding.etVisitorName.text?.clear()
        binding.etVisitorCompany.text?.clear()

        binding.btnCapture.visibility = View.VISIBLE
        binding.btnCapture.text = getString(R.string.capture_badge)
        binding.btnStartSession.visibility = View.VISIBLE
        binding.btnStartSession.isEnabled = false
        binding.btnEndSession.visibility = View.GONE

        showProgress(false)
        startCameraPreview()
    }

    private fun showProgress(show: Boolean) {
        if (show) {
            binding.progressBar.visibility = View.VISIBLE
            binding.progressBar.startAnimation(
                AnimationUtils.loadAnimation(this, R.anim.spin)
            )
        } else {
            binding.progressBar.clearAnimation()
            binding.progressBar.visibility = View.GONE
        }
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    override fun onDestroy() {
        timerHandler.removeCallbacks(timerRunnable)
        super.onDestroy()
        cameraManager.shutdown()
        ocrProcessor.close()
    }

    companion object {
        private const val TAG = "MainActivity"
    }
}
