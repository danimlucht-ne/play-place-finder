package org.community.playgroundfinder.ui.screens.admin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.community.playgroundfinder.ui.composables.FormColors

/** Same headline and helper copy on every admin queue (moderation, support, seed, ad review). */
@Composable
fun AdminEmptyQueueMessage(
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = modifier.padding(24.dp).fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "The queue is empty.",
            fontSize = 16.sp,
            color = FormColors.BodyText,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "When something needs your attention, it will appear here.",
            fontSize = 13.sp,
            color = FormColors.SecondaryButtonText,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        TextButton(onClick = onRefresh) { Text("Refresh") }
    }
}
