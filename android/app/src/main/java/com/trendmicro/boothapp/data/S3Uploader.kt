package com.trendmicro.boothapp.data

import android.util.Log
import com.amazonaws.auth.BasicAWSCredentials
import com.amazonaws.regions.Region
import com.amazonaws.regions.Regions
import com.amazonaws.services.s3.AmazonS3Client
import com.amazonaws.services.s3.model.ObjectMetadata
import com.amazonaws.services.s3.model.PutObjectRequest
import com.amazonaws.services.s3.model.SSEAwsKeyManagementParams
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import com.trendmicro.boothapp.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.nio.charset.StandardCharsets
import java.time.Instant

/**
 * Uploads badge photos and metadata to the S3 session bucket.
 * Key format per DATA-CONTRACT.md: sessions/<session-id>/badge.jpg
 */
class S3Uploader(
    accessKeyId: String,
    secretAccessKey: String,
    private val bucket: String = BuildConfig.S3_BUCKET,
    region: String = BuildConfig.AWS_REGION
) {
    private val s3Client: AmazonS3Client
    private val kmsKeyAlias = "alias/hackathon26-cmk"

    init {
        val credentials = BasicAWSCredentials(accessKeyId, secretAccessKey)
        s3Client = AmazonS3Client(credentials)
        s3Client.setRegion(Region.getRegion(Regions.fromName(region)))
    }

    /**
     * Upload a file to S3.
     * @param file Local file to upload
     * @param key S3 object key (e.g. "sessions/A7K29F3X/badge.jpg")
     * @param contentType MIME type
     */
    suspend fun upload(file: File, key: String, contentType: String = "image/jpeg"): Result<String> =
        withContext(Dispatchers.IO) {
            try {
                val metadata = ObjectMetadata().apply {
                    this.contentType = contentType
                    this.contentLength = file.length()
                }
                val request = PutObjectRequest(bucket, key, FileInputStream(file), metadata)
                    .withSSEAwsKeyManagementParams(SSEAwsKeyManagementParams(kmsKeyAlias))
                s3Client.putObject(request)
                Log.d(TAG, "Uploaded $key to $bucket")
                Result.success(key)
            } catch (e: Exception) {
                Log.e(TAG, "S3 upload failed for $key", e)
                Result.failure(e)
            }
        }

    /**
     * Upload badge photo for a session.
     * @param sessionId Session ID (e.g. "A7K29F3X")
     * @param badgeFile Local JPEG file of the badge photo
     */
    suspend fun uploadBadge(sessionId: String, badgeFile: File): Result<String> =
        upload(badgeFile, "sessions/$sessionId/badge.jpg", "image/jpeg")

    data class SessionMetadata(
        @SerializedName("session_id") val sessionId: String,
        @SerializedName("visitor_name") val visitorName: String,
        @SerializedName("visitor_company") val visitorCompany: String?,
        @SerializedName("badge_photo") val badgePhoto: String = "badge.jpg",
        @SerializedName("started_at") val startedAt: String,
        @SerializedName("demo_pc") val demoPc: String,
        @SerializedName("se_name") val seName: String?,
        @SerializedName("audio_consent") val audioConsent: Boolean,
        val status: String = "active"
    )

    suspend fun uploadMetadata(
        sessionId: String,
        visitorName: String,
        visitorCompany: String?,
        demoPc: String,
        seName: String?,
        audioConsent: Boolean
    ): Result<String> = withContext(Dispatchers.IO) {
        try {
            val metadata = SessionMetadata(
                sessionId = sessionId,
                visitorName = visitorName,
                visitorCompany = visitorCompany,
                startedAt = Instant.now().toString(),
                demoPc = demoPc,
                seName = seName,
                audioConsent = audioConsent
            )
            val json = Gson().toJson(metadata)
            val bytes = json.toByteArray(StandardCharsets.UTF_8)
            val key = "sessions/$sessionId/metadata.json"
            val objMetadata = ObjectMetadata().apply {
                contentType = "application/json"
                contentLength = bytes.size.toLong()
            }
            val request = PutObjectRequest(bucket, key, ByteArrayInputStream(bytes), objMetadata)
                .withSSEAwsKeyManagementParams(SSEAwsKeyManagementParams(kmsKeyAlias))
            s3Client.putObject(request)
            Log.d(TAG, "Uploaded metadata.json for session $sessionId")
            Result.success(key)
        } catch (e: Exception) {
            Log.e(TAG, "Metadata upload failed for $sessionId", e)
            Result.failure(e)
        }
    }

    companion object {
        private const val TAG = "S3Uploader"
    }
}
