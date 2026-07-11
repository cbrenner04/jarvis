#!/bin/bash

# Update the description for implement preset (line 190)
sed -i '190s/For `implement`, the caller.*that step/For `implement`, the caller/' v2/docs/workflow-runner.md

# Update the list item for implement
sed -i 's/^- `implement`: one step, with/- `implement`: one or two steps, with/' v2/docs/workflow-runner.md

# Update the description to say "on both positions"
sed -i '197s/fixed by the preset$/fixed by the preset on both positions/' v2/docs/workflow-runner.md

echo "Done"
