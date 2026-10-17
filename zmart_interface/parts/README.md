# Parts

A part is what more than one workflow is built from. It knows no workflow
and no microscope: it would work as it is in a workflow nobody has written
yet.

The test is the oven: could this module serve a workflow that has nothing to
do with a microscope -- an e-learning course on cleaning an oven, say? If
not, it is not a part, and it stays in the workflow that uses it.

A piece of code starts inside the workflow that needs it. It moves here when
a second workflow needs it too, and not before.

Target acquisition is the only workflow today, so everything it is built
from -- the canvas, the microscope seam, the storage, the analysis, the mock
microscope -- lives in its own folder, and this one is empty.
