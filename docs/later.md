# Things for later

Ideas and improvements that were discussed and deliberately left for later.
Each says what happens at the microscope today, what would change, and why
it waits. When one is taken up, it moves out of this list and into the work.

## A carrier that sits slightly turned in its holder

**Today.** When the carrier is aligned, the interface corrects for the plate
being *shifted* on the stage, not for it being *turned*. The points you snap
are averaged into one shift. A plate that sits half a degree crooked puts the
wells far from the alignment points about half a millimetre off. Since
10 October 2026 the Define Carrier panel says so when the snapped points
disagree by more than 200 µm, but nothing corrects it.

**What would change.** With two or more points snapped, the interface would
work out the turn as well as the shift, and every well would be driven to
its turned position. The panel would say how well the points agree after
that correction.

**Why it waits.** It changes where the stage goes for every well, so it
needs a careful test on a real plate first. Raised as finding 7 in
`REVIEW_2026-10-10.md`.

## Where the slices of a stack are, said by the controller

**Today.** When the microscope takes a stack (for the focus map, or before
each target), the driver reports for every slice the stage height it was
taken at, in the same coordinates the stage is driven in. That is the
controller's rule, the Leica driver follows it, and since 10 October 2026
the interface uses those heights exactly as reported, with no correction of
its own.

**What would change.** The controller would also carry where the slices are
in the image files' own metadata, and give it back as information a client
can ask for, so that every program that reads the files (the interface, the
viewer, an analysis script) places them the same way without each working
it out.

**Why it waits.** How the controller should do this still has to be thought
through; it is the controller's design, and the interface and the viewer
then simply place things where the controller says.

## The same software on every microscope computer

**Today.** Installing the interface fetches the newest version of the other
ZMART parts (the controller, the viewer, the analysis) at that moment. Two
microscope computers installed a week apart can therefore run different
versions, and behave differently, without anyone having changed anything on
purpose.

**What would change.** When something goes onto a microscope, the exact
versions that were tested together would be written down in one file, and
the microscope installation would install exactly those. Development would
keep using the newest versions; only the microscope installation would be
fixed to a tested set, and that set would be raised on purpose.

**Why it waits.** It changes how a release is made across all six ZMART
repositories, not only this one. Raised as finding 17 in
`REVIEW_2026-10-10.md`.
