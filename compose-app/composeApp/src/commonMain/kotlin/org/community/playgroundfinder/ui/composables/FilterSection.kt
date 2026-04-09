package org.community.playgroundfinder.ui.composables

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FilterSection(
    title: String,
    options: List<String>,
    selected: String?,
    onSelect: (String?) -> Unit,
    showTitle: Boolean = true,
) {
    if (showTitle) {
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(top = 20.dp, bottom = 8.dp),
        )
    }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.padding(top = if (showTitle) 0.dp else 4.dp),
    ) {
        options.forEach { option ->
            FilterChip(
                selected = selected == option,
                onClick = { onSelect(if (selected == option) null else option) },
                label = { Text(option) },
                shape = RoundedCornerShape(20.dp),
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = FormColors.SelectedChip, selectedLabelColor = FormColors.SelectedChipText)
            )
        }
    }
}

@Composable
fun AmenityToggle(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    FilterChip(
        selected = checked,
        onClick = { onCheckedChange(!checked) },
        label = { Text(label) },
        shape = RoundedCornerShape(20.dp),
        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = FormColors.SelectedChip, selectedLabelColor = FormColors.SelectedChipText)
    )
}
