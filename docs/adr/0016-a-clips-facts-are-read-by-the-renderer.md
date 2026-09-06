# A clip's facts are read by the renderer, once, at import

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

A sound's length, channel count and sample rate are worth showing. **There is no `decodeAudioData`
under Node**, so the main process cannot read them the way it sniffs an Ultra HDR marker out of a
JPEG — it would need a header parser per format for three numbers of display.

## Decision

The renderer reads them, during the import dialog that already decodes the file for its preview, and
writes them into the settings that become the sidecar.

## Consequences

The facts are **optional**, and absent for two legitimate reasons: a file dropped into `assets/` from
outside the editor never passed through the import dialog, and a file this browser cannot decode has no
facts to report.

Where they are missing the Project panel says nothing rather than showing a placeholder. That is the
honest answer, and the numbers appear the day the file is imported properly.
