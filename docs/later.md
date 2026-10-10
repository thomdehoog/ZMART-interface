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
