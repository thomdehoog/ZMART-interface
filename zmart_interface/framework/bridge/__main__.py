"""``python -m zmart_interface.framework.bridge``: the bridge on its own, for a browser.

Every workflow's Python half starts with it, so this offers what the
interface's window offers, the mock microscope first.
"""

import sys

from .server import main

sys.exit(main())
