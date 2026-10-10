"""``python -m zmart_interface.framework.bridge``: the general bridge on its own, for a browser.

It offers only the microscopes the controller lists; the interface's own way
in, with its mock microscope, is ``python -m zmart_interface.serving``.
"""

import sys

from .server import main

sys.exit(main())
