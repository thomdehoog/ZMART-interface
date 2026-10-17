# Parts

A part is what more than one workflow is built from. It knows no workflow
and no microscope: it would work as it is in a workflow nobody has written
yet.

A piece of code starts inside the workflow that needs it. It moves here when
a second workflow needs it too, and not before.

Target acquisition is the only workflow today, so the page code it is built
from -- the canvas, the microscope seam -- lives in its own folder. The
Python still here is on its way there too.
