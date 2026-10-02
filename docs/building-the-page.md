# Building the page

The operator page is written in JavaScript under `zmart_interface/` and built
with Vite into three files that ship inside the Python package. Node 22.12 or
newer is needed for the build, on a developer machine; the microscope PC never
builds anything.

```bash
npm ci            # the page's packages, and neuroglancer's patch
npm run build     # the page and two files beside it -> zmart_interface/framework/window/static/
npm run dev       # http://127.0.0.1:5174, reloads on save; open it with `zmart-interface --dev`
```

The build also needs ZMART-viewer installed in the Python it runs with
(`PYTHON=` names that Python when it is not the one on the path): neuroglancer
is patched for pictures that grow while they are on screen, and those patches
belong to the viewer (`zmart_viewer/drawing/neuroglancer-growth.mjs`), so the
page and the viewer draw with the same neuroglancer.

On the ZMB workstations AppLocker runs programs only from
`C:\ProgramData\MinicondaZMB`, so the checkout, `node_modules` and the
Playwright browsers must live there.

## What the build produces, and why it is three files rather than one

`npm run build` writes three files into `zmart_interface/framework/window/static/`:

| file | what it is | how large |
| --- | --- | --- |
| `index.html` | the whole page — every script, every stylesheet, folded in | ~4 MB |
| `chunk_worker.bundle-*.js` | neuroglancer fetches pieces of image in this | ~0.9 MB |
| `async_computation.bundle.js` | neuroglancer unpacks them in this | ~1.6 MB |

Those three are what has to reach the microscope computer, and they have to stay
in one folder together. The page opens and draws with the two Viv engines
whether or not the other two came along; the third engine, neuroglancer, needs
them.

Everything is folded into the page because the microscope PC has no toolchain
and no network: the build happens on a developer machine, the three files ship
inside the Python package, and the bridge hands them out.

### Why neuroglancer cannot be folded in

Neuroglancer hands two jobs to *background programs* — separate pieces of
JavaScript running alongside the page, so that fetching and unpacking pieces of
image does not freeze what the operator is looking at. A browser will only start
one of those from a file of its own.

Folding them into the page was tried properly before this was accepted, and it
failed twice over:

1. **The build tool will not compile them.** Neuroglancer ships each background
   program as a twenty-line list of imports written in a shorthand only a build
   tool can read. Vite does not read it: where neuroglancer asks for a background
   program, Vite copies the file across exactly as it found it. Folded into the
   page that way, the browser cannot make sense of it, the program never starts,
   and nothing reports an error — the description of a run loads and the picture
   never appears. The only place Vite will accept a compiled program is the file
   on disk inside `node_modules`, which is why `neuroglancer-workers.mjs` writes
   there; a plugin handing Vite the compiled program instead was tried and Vite
   never asked for it.
2. **Even compiled, it is too large to fold in.** A background program folded
   into a page stops being a file and becomes a very long address — about a
   third longer than the program itself, because of how it has to be written
   down — and Chromium refuses to start one from an address longer than about
   2 MB. Measured in this browser: a 1.5 MB program started, a 2 MB one did not,
   and the one that did not throw nothing, warn about nothing, and appear
   nowhere. It simply never ran. The two programs come to about 2.5 MB together,
   and they have to be folded together, because a folded program cannot look up
   a file beside itself and the fetching one starts the unpacking one that way.

So the page is folded into one file and the two background programs sit beside
it. `neuroglancer-workers.mjs` compiles them; `vite.config.js` places them.

### What that costs

Three things, and it is worth being honest about which of them actually matter.

**Copying a folder rather than a file.** This turns out to be very little. None
of the reasons for one file were about the copying: the microscope PC still does
not build anything, the files still arrive already built, and Python still hands
them out. A folder copies as easily as a file so long as it is copied *whole* —
which is the one new way to get this wrong, and why the build produces exactly
three files and `zmart_interface/framework/the-built-page.spec.js` says so out loud.

**Opened straight off the disk — a `file:///…` address, which double-clicking
the page does — the third engine cannot work.** A browser gives such a page no
address of its own and refuses to start a background program for it. The page
knows this and offers only the two engines that can draw, with a sentence in the
corner saying where the third went. Serve the folder over HTTP and all three are
there; the `zmart-interface` window now does exactly that, which is also the
closer imitation of how the page will really be handed out.

`build.outDir` points at `zmart_interface/framework/window/static/`, beside the
window that shows it. The built files are committed and ship in the package,
because the microscope PC cannot build them; rebuild and commit them after any
change to the page's sources.

