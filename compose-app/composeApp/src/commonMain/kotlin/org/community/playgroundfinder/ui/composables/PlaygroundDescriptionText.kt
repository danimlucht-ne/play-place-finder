package org.community.playgroundfinder.ui.composables

import androidx.compose.foundation.text.ClickableText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

private val urlRegex = Regex("""(https?://[^\s<>"')]+[^\s<>"').,;!?]*)""", RegexOption.IGNORE_CASE)

/**
 * Renders [text] with http(s) spans tappable via [onLinkClick].
 */
@Composable
fun PlaygroundDescriptionWithLinks(
    text: String,
    modifier: Modifier = Modifier,
    baseColor: Color = Color(0xFF424242),
    linkColor: Color = Color(0xFF1565C0),
    fontSize: TextUnit = 14.sp,
    onLinkClick: (String) -> Unit,
) {
    val annotated = buildAnnotatedString {
        var i = 0
        for (m in urlRegex.findAll(text)) {
            if (m.range.first > i) {
                append(text.substring(i, m.range.first))
            }
            val raw = m.value
            val url = raw.trimEnd('.', ',', ';', '!', '?', ')', ']')
            pushStringAnnotation(tag = "URL", annotation = url)
            pushStyle(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))
            append(url)
            pop()
            pop()
            i = m.range.last + 1
        }
        if (i < text.length) {
            append(text.substring(i))
        }
    }
    ClickableText(
        text = annotated,
        modifier = modifier,
        style = TextStyle(color = baseColor, fontSize = fontSize),
        onClick = { offset ->
            annotated.getStringAnnotations(tag = "URL", start = offset, end = offset)
                .firstOrNull()
                ?.let { onLinkClick(it.item) }
        },
    )
}
