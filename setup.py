"""Leave the tests out of the installed interface.

Everything about the package is described in ``pyproject.toml``; this file
adds the one thing that cannot be said there. Each part of the interface keeps
its tests beside its code, in the same folder, so that whoever changes a step
finds its tests next to it. Python packaging copies every ``.py`` file of a
package into the wheel, and has no setting in ``pyproject.toml`` that leaves
some of them out: ``exclude-package-data`` only applies to files that are not
Python. So the step that copies the modules is told here to skip the tests.

A microscope PC then receives the interface and its built page, and nothing
that only runs on a developer's machine. A clone installed for development
(``pip install -e ".[dev]"``) still has every test, because it runs from the
folder itself.
"""

from setuptools import setup
from setuptools.command.build_py import build_py


def _is_a_test(module: str) -> bool:
    """Whether a module only serves pytest: a test file, or pytest's shared setup."""
    return module.startswith("test_") or module == "conftest"


class _WithoutTheTests(build_py):
    """Copy a package's modules into the wheel, all but its tests."""

    def find_package_modules(self, package, package_dir):
        found = super().find_package_modules(package, package_dir)
        return [(pkg, module, path) for pkg, module, path in found if not _is_a_test(module)]


setup(cmdclass={"build_py": _WithoutTheTests})
