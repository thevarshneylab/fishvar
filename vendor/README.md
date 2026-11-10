# Vendored guide engine

`umax.js` and `editors.json` are copied unmodified from
[thevarshneylab/umax-guide-designer](https://github.com/thevarshneylab/umax-guide-designer)
at the commit recorded in `UMAX_COMMIT`.

They are used read-only. `fishvar` calls the engine's exported API rather than
reimplementing guide finding, scoring or protein-consequence calling, so the
ranking heuristic has exactly one implementation across the two tools.

Do not edit these files here. To track a newer upstream, either refresh this
directory from that repo and update `UMAX_COMMIT`, or leave it alone and point
`--umax-path` at a checkout:

    fishvar VCV000012345 --umax-path ../umax-guide-designer

Both projects are MIT licensed.
