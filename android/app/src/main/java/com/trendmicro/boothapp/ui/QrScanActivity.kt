package com.trendmicro.boothapp.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.trendmicro.boothapp.R
import com.trendmicro.boothapp.data.AppPreferences
import com.trendmicro.boothapp.databinding.ActivityQrScanBinding
import java.util.concurrent.Executors

/**
 * Scans a QR code to pair the phone with a demo PC.
 *
 * Supports two QR formats:
 *
 * v2 (management server — caseyapp-pair):
 * { "type": "caseyapp-pair", "v": 2, "managementUrl": "...", "eventId": 3,
 *   "demoPcId": "booth-pc-1", "badgeFields": ["name","company","title"],
 *   "eventName": "Black Hat 2026" }
 *
 * v1 (direct S3 — boothapp-pair):
 * { "type": "boothapp-pair", "v": 1, "s3Bucket": "...", "s3Region": "...",
 *   "presignEndpoint": "...", "awsAccessKeyId": "...", "awsSecretAccessKey": "..." }
 */
class QrScanActivity : AppCompatActivity() {

    private lateinit var binding: ActivityQrScanBinding
    private lateinit var prefs: AppPreferences
    private var scanned = false

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            startCamera()
        } else {
            Toast.makeText(this, R.string.camera_permission_required, Toast.LENGTH_LONG).show()
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityQrScanBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = AppPreferences(this)

        binding.btnCancel.setOnClickListener { finish() }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            startCamera()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    @androidx.camera.core.ExperimentalGetImage
    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()

            val preview = Preview.Builder().build().also {
                it.surfaceProvider = binding.previewView.surfaceProvider
            }

            val scanner = BarcodeScanning.getClient()
            val analysisExecutor = Executors.newSingleThreadExecutor()

            val imageAnalysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()

            imageAnalysis.setAnalyzer(analysisExecutor) { imageProxy ->
                val mediaImage = imageProxy.image
                if (mediaImage != null && !scanned) {
                    val inputImage = InputImage.fromMediaImage(
                        mediaImage, imageProxy.imageInfo.rotationDegrees
                    )
                    scanner.process(inputImage)
                        .addOnSuccessListener { barcodes ->
                            for (barcode in barcodes) {
                                if (barcode.valueType == Barcode.TYPE_TEXT ||
                                    barcode.valueType == Barcode.TYPE_UNKNOWN
                                ) {
                                    val raw = barcode.rawValue ?: continue
                                    if (handleQrPayload(raw)) {
                                        scanned = true
                                        return@addOnSuccessListener
                                    }
                                }
                            }
                        }
                        .addOnCompleteListener {
                            imageProxy.close()
                        }
                } else {
                    imageProxy.close()
                }
            }

            cameraProvider.unbindAll()
            cameraProvider.bindToLifecycle(
                this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageAnalysis
            )
        }, ContextCompat.getMainExecutor(this))
    }

    private fun handleQrPayload(raw: String): Boolean {
        try {
            val gson = Gson()
            val json = gson.fromJson(raw, JsonObject::class.java)

            val type = json.get("type")?.asString ?: return false

            when (type) {
                // v2: management server pairing (caseyapp-pair)
                "caseyapp-pair" -> {
                    val managementUrl = json.get("managementUrl")?.asString ?: ""
                    val eventId = json.get("eventId")?.asInt ?: 0
                    val demoPcId = json.get("demoPcId")?.asString ?: ""
                    val eventName = json.get("eventName")?.asString ?: ""
                    val badgeFields = json.get("badgeFields")?.asJsonArray
                        ?.joinToString(",") { it.asString } ?: "name,company,title"

                    if (managementUrl.isNotBlank()) {
                        prefs.orchestratorUrl = managementUrl
                    }
                    prefs.eventId = eventId
                    prefs.eventName = eventName
                    prefs.defaultDemoPc = demoPcId
                    prefs.badgeFields = badgeFields

                    Log.d(TAG, "QR v2 pairing: management=$managementUrl event=$eventName pc=$demoPcId")
                }

                // v1: direct S3 pairing (boothapp-pair)
                "boothapp-pair" -> {
                    val presign = json.get("presignEndpoint")?.asString ?: ""
                    val accessKey = json.get("awsAccessKeyId")?.asString ?: ""
                    val secretKey = json.get("awsSecretAccessKey")?.asString ?: ""

                    prefs.awsAccessKeyId = accessKey
                    prefs.awsSecretAccessKey = secretKey
                    if (presign.isNotBlank()) {
                        prefs.orchestratorUrl = presign
                    }

                    Log.d(TAG, "QR v1 pairing: bucket=${json.get("s3Bucket")?.asString}")
                }

                else -> return false
            }

            runOnUiThread {
                Toast.makeText(this, "Paired successfully!", Toast.LENGTH_SHORT).show()
                val resultIntent = Intent()
                resultIntent.putExtra(EXTRA_PAIRED, true)
                resultIntent.putExtra(EXTRA_BUCKET, json.get("s3Bucket")?.asString ?: "")
                resultIntent.putExtra(EXTRA_REGION, json.get("s3Region")?.asString ?: "")
                setResult(RESULT_OK, resultIntent)
                finish()
            }

            return true
        } catch (e: Exception) {
            Log.w(TAG, "QR parse failed: ${e.message}")
            return false
        }
    }

    companion object {
        private const val TAG = "QrScanActivity"
        const val EXTRA_PAIRED = "paired"
        const val EXTRA_BUCKET = "bucket"
        const val EXTRA_REGION = "region"
    }
}
