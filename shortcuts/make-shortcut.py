#!/usr/bin/env python3
"""Generate + sign the "Parallax Render" Apple Shortcut.

Run via dotenvx so PARALLAX_TOKEN is in the env (never printed):
    bash scripts/dotenvx-wrap.sh python3 shortcuts/make-shortcut.py <base-url> <out.shortcut>

The shortcut: accepts an image from the share sheet, POSTs the raw bytes to
/api/render with the bearer token, Quick Looks the returned comic PNG.
Import the signed file on the Mac (double-click) — iCloud syncs it to the iPad.
"""
import os
import plistlib
import subprocess
import sys
import tempfile

base_url, out_path = sys.argv[1], sys.argv[2]
token = os.environ["PARALLAX_TOKEN"]  # KeyError = fail loudly, never a tokenless shortcut

text = lambda s: {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}

workflow = {
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowClientVersion": "2605.0.5",
    "WFWorkflowHasOutputFallback": False,
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 0xFF4351FF, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowImportQuestions": [],
    # ActionExtension + image input = shows up in the share sheet for any image
    "WFWorkflowTypes": ["ActionExtension"],
    "WFWorkflowInputContentItemClasses": ["WFImageContentItem"],
    "WFWorkflowActions": [
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "WFURL": f"{base_url}/api/render",
                "WFHTTPMethod": "POST",
                "ShowHeaders": True,
                "WFHTTPHeaders": {
                    "Value": {
                        "WFDictionaryFieldValueItems": [
                            {
                                "WFItemType": 0,
                                "WFKey": text("Authorization"),
                                "WFValue": text(f"Bearer {token}"),
                            }
                        ]
                    },
                    "WFSerializationType": "WFDictionaryFieldValue",
                },
                "WFHTTPBodyType": "File",
                "WFRequestVariable": {
                    "Value": {"Type": "ExtensionInput"},
                    "WFSerializationType": "WFTextTokenAttachment",
                },
            },
        },
        # Save the comic to Photos FIRST — durable even when the share-sheet Quick Look
        # never appears (it's flaky when the sheet closes before the render returns).
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.savetocameraroll",
            "WFWorkflowActionParameters": {},
        },
        # Then try to preview it
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.previewdocument",
            "WFWorkflowActionParameters": {},
        },
    ],
}

with tempfile.NamedTemporaryFile(suffix=".shortcut", delete=False) as f:
    plistlib.dump(workflow, f, fmt=plistlib.FMT_BINARY)
    unsigned = f.name

subprocess.run(
    ["shortcuts", "sign", "--mode", "anyone", "--input", unsigned, "--output", out_path],
    check=True,
)
os.unlink(unsigned)
print(f"signed shortcut written: {out_path}")
