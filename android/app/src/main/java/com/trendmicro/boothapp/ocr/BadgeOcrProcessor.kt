package com.trendmicro.boothapp.ocr

import android.graphics.Bitmap
import android.util.Log
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Extracts visitor name and company from a badge photo using ML Kit OCR.
 *
 * Badge layout heuristics:
 * - Name is typically the largest text block (biggest font on badge)
 * - Company is usually the second-largest or directly below the name
 * - Filters out common noise: event names, dates, barcodes, QR labels
 */
class BadgeOcrProcessor {

    data class BadgeInfo(
        val name: String,
        val company: String,
        val rawText: String
    )

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.Builder().build())

    // Common noise patterns found on conference badges
    private val noisePatterns = listOf(
        Regex("(?i)(black\\s*hat|rsac|reinvent|aws|defcon|re:invent)"),
        Regex("(?i)(august|september|october|november|december|january|february|march|april|may|june|july)\\s+\\d{1,2}"),
        Regex("(?i)\\d{4}\\s*(las vegas|san francisco|seattle|boston|orlando)"),
        Regex("(?i)(attendee|speaker|exhibitor|sponsor|press|staff|vip)"),
        Regex("(?i)(scan|badge|qr|barcode|id:?)"),
        Regex("^\\d{5,}$"),  // Long numbers (badge IDs)
        Regex("^[A-Z0-9]{2,4}-\\d+$"),  // Badge codes like "BH-12345"
        // Badge field labels printed above the actual values
        Regex("(?i)^\\s*(first\\s*name|last\\s*name|full\\s*name|name|company|organization|org|title|role|email|e-?mail|phone|country|city|state|job\\s*title|department|dept|registration|reg\\.?\\s*#?)\\s*:?\\s*$"),
    )

    suspend fun process(bitmap: Bitmap): BadgeInfo = suspendCancellableCoroutine { cont ->
        val image = InputImage.fromBitmap(bitmap, 0)

        recognizer.process(image)
            .addOnSuccessListener { result ->
                val rawText = result.text
                Log.d(TAG, "OCR raw text:\n$rawText")

                // Get text blocks sorted by bounding box height (proxy for font size)
                val blocks = result.textBlocks
                    .filter { block ->
                        val text = block.text.trim()
                        text.isNotBlank() &&
                            text.length >= 2 &&
                            noisePatterns.none { it.containsMatchIn(text) }
                    }
                    .sortedByDescending { it.boundingBox?.height() ?: 0 }

                val name: String
                val company: String

                if (blocks.size >= 2) {
                    // Largest text = name, second largest = company
                    name = cleanName(blocks[0].text)
                    company = cleanCompany(blocks[1].text)
                } else if (blocks.size == 1) {
                    // Single block - try splitting by lines
                    val lines = blocks[0].text.split("\n").map { it.trim() }.filter { it.isNotBlank() }
                    name = if (lines.isNotEmpty()) cleanName(lines[0]) else ""
                    company = if (lines.size >= 2) cleanCompany(lines[1]) else ""
                } else {
                    name = ""
                    company = ""
                }

                cont.resume(BadgeInfo(name = name, company = company, rawText = rawText))
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "OCR failed", e)
                cont.resume(BadgeInfo(name = "", company = "", rawText = ""))
            }
    }

    private fun cleanName(raw: String): String {
        return raw.trim()
            .replace(Regex("[^\\p{L}\\s.'-]"), "") // Keep letters, spaces, dots, hyphens, apostrophes
            .replace(Regex("\\s+"), " ")
            .trim()
            .split(" ")
            .joinToString(" ") { it.replaceFirstChar { c -> c.uppercase() } }
    }

    private fun cleanCompany(raw: String): String {
        return raw.trim()
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    fun close() {
        recognizer.close()
    }

    companion object {
        private const val TAG = "BadgeOCR"
    }
}
