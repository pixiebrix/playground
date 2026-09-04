// Bundled rather than loaded from a CDN like the other playground editors: esm.sh's graph for
// @atlaskit/editor-core runs past 5,000 modules with 500s among them, and Atlassian ships no UMD build.

import React from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "react-intl";
import { ComposableEditor } from "@atlaskit/editor-core/composable-editor";
import { createDefaultPreset } from "@atlaskit/editor-core/preset-default";
import { alignmentPlugin } from "@atlaskit/editor-plugins/alignment";
import { indentationPlugin } from "@atlaskit/editor-plugins/indentation";
import { insertBlockPlugin } from "@atlaskit/editor-plugins/insert-block";
import { listPlugin } from "@atlaskit/editor-plugins/list";
import { panelPlugin } from "@atlaskit/editor-plugins/panel";
import { textColorPlugin } from "@atlaskit/editor-plugins/text-color";
import { toolbarListsIndentationPlugin } from "@atlaskit/editor-plugins/toolbar-lists-indentation";

const h = React.createElement;

// The editor takes ADF, not HTML; an HTML string is accepted and silently yields an empty document.
const defaultValue = {
	version: 1,
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [{ type: "text", text: "This is an editor" }],
		},
	],
};

/**
 * Render the editor into `element` with the Jira-comment chrome, which exposes the same
 * `#ak-editor-textarea` contenteditable and `akEditor` class as a real Jira or Confluence page.
 */
export function mount(element) {
	// `useUniversalPreset` — what the deprecated `Editor` component uses — adds media, smart-card,
	// tables, emoji, mentions and embedded-confluence, tripling the bundle to 17.6MB.
	const preset = createDefaultPreset({ appearance: "comment" })
		.add(listPlugin)
		.add(panelPlugin)
		.add(textColorPlugin)
		.add(alignmentPlugin)
		.add(indentationPlugin)
		.add([
			toolbarListsIndentationPlugin,
			{ showIndentationButtons: true, allowHeadingAndParagraphIndentation: true },
		])
		.add(insertBlockPlugin);

	createRoot(element).render(
		h(
			IntlProvider,
			{ locale: "en" },
			h(ComposableEditor, { appearance: "comment", preset, defaultValue }),
		),
	);
}
