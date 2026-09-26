# P5 CTS Mission Recording — Format Reference (`.msnP5` / `.rpt` / `.teq`)

Reverse-engineered from a single specimen — one training sortie, delivered as a
446,680,852 B `.msnP5` + 234,432 B `.rpt` + 220,000 B `.teq`. The recording
itself is operational data and is not in this repository; the byte sizes are
quoted because the container arithmetic below closes on them exactly. Roster
values, clock values and dates shown in examples are **synthetic stand-ins** of
the right shape, not the ones in the specimen.

**There is no vendor specification behind this document.** Every claim below is
tagged with its evidence tier:

| Tier | Meaning |
|---|---|
| **[C]** Confirmed | Derived from the bytes and validated across the whole file. Arithmetic closes exactly. |
| **[I]** Inferred | Consistent with the data and with domain context, but not provable from one specimen. |
| **[U]** Unknown | Byte positions identified; meaning not determined. **Must be preserved verbatim on export.** |

Validation run: all 9,941 blocks / 99,409 subframes / 4,970,450 slot records
parsed with zero structural violations. See "Validation invariants" below.

---

## 1. Identification

**[I]** The triple is a **P5 Combat Training System** (P5CTS / TCTS) mission
recording — an air-combat training instrumentation dataset. Evidence is
circumstantial but consistent: the `.msnP5` extension and a `P5` filename token;
a 50-slot roster of squadron / flight-callsign / aircraft-id triples of the kind
a USAF training range provisions; and a US range name in the filename. There is
no vendor string, magic ASCII or version record anywhere in the file to confirm
it.

**[C]** The three files are one set and are **not independent**:

| File | Role |
|---|---|
| `.msnP5` | The recording. Time-ordered blocks of per-participant samples. |
| `.rpt` | **Block index into the `.msnP5`.** A size/offset table; redundant with the fixed block sizes, so a reader can derive it, but it is the authoritative block count. |
| `.teq` | Preallocated, **empty** in this specimen (6 non-zero bytes total). |

---

## 2. Conventions

**[C]** All multi-byte integers are **big-endian**. All floats are IEEE-754
**big-endian binary32**. Strings are ASCII, NUL-padded to a fixed width (not
NUL-terminated — a value may fill its field completely).

Timestamps are a 4-byte group: `HH MM SS CC` as **plain binary bytes, not
BCD**. The distinction is not academic: the bytes `13 22 30` are a valid clock
under *both* readings — 19:34:48 as binary, 13:22:30 as BCD — so a reader that
guesses wrong produces plausible, silently wrong timestamps. The file's own
arithmetic settles it: blocks are one second apart, and for every block *N* the
header clock equals the start clock plus *N* seconds under the binary reading
and drifts under the BCD one. `CC` is centiseconds and always steps by 10.

---

## 3. `.rpt` — block index  **[C]**

```
offset  size  field
0x0000  u32   blockCount            (9941 in specimen)
0x0004  u32   unknown, = 2                                        [U]
0x0008  8     mission date, ASCII "MM/DD/YY"    (e.g. "09/17/26")
0x0010  16    mission date, ASCII "D MMM YY "   (e.g. "17 SEP 26 ")  NUL-padded
0x0020  u32   unknown, = 0x40010000                               [U]
0x0024  ...   zero padding
0x0FC0  8*N   index entries
```

Each 8-byte entry is `{ u32 blockSize; u32 blockOffset }` into the `.msnP5`.

Invariants, all verified on the specimen:

- `entry[0] = { 56772, 0 }` — block 0 is larger than the rest.
- `entry[i>0].blockSize = 44932` for every other block.
- Entries are **contiguous**: `offset[i] = offset[i-1] + size[i-1]`.
- `offset[N-1] + size[N-1]` equals the `.msnP5` size **exactly**.

Bytes after the last entry are zero fill; the file is preallocated — in the
specimen the payload ended at 83,560 of 234,432 bytes.

> The index is redundant with the fixed block sizes, so a reader can walk the
> `.msnP5` without it — but it is the cheap, authoritative way to get block
> count and to seek, and an exporter **must** rewrite it if block sizes change.

---

## 4. `.teq` — equipment/config table  **[C: empty]**

220,000 bytes. Only the first 8 are non-zero:

```
05 01 03 00 HH MM SS 00
```

Bytes 4–6 are the mission start clock, matching the `.msnP5` header; bytes 0–3
are **[U]**. The remaining 219,992 bytes are zero.

**[I]** 220,000 = 50 × 4,400 = the roster size × the subframe record area, which
suggests a per-participant table that this mission never populated. Nothing in
this specimen constrains its record layout. Treat `.teq` as an opaque blob:
carry it through unchanged, and do not claim to parse it.

---

## 5. `.msnP5` — the recording

### 5.1 Block layout  **[C]**

The file is a flat sequence of blocks, one per **second** of mission time.

```
block 0        56,772 B = 12 (block header) + 16,332 (config region) + 9 × 4,492
block 1..N-1   44,932 B = 12 (block header) +                          10 × 4,492
```

Both equalities are exact. In the specimen, total subframes = 9 + 9,940 × 10 =
**99,409**, which at 10 Hz is 9,940.9 s — and the difference between the first
and last subframe clocks is exactly that, to the centisecond.

**Block header (12 B):**

| offset | type | meaning |
|---|---|---|
| 0 | u32 | `0x00000100` in block 0, `0` in every other block. File magic / version. **[I]** |
| 4 | u32 | always 0 |
| 8 | 4 | timestamp of the **last** subframe in this block |

### 5.2 Subframe (4,492 B)  **[C]**

One 10 Hz sample epoch for every roster slot.

```
4,492 = 20 (header) + 50 × 88 (slot records) + 72 (trailer)
```

**Subframe header (20 B):**

| offset | type | value | meaning |
|---|---|---|---|
| 0 | u32 | `0x00000452` (1106) | constant across all 99,409 subframes **[U]** |
| 4 | u32 | `0x04010003` | constant **[U]** |
| 8 | 4 | `HH MM SS CC` | **data-valid time.** Steps by exactly 10 cs, everywhere. |
| 12 | u32 | derived | **[C]** Not a second clock: it is bytes 8–11 XORed with `0x04010003`. Verified with zero exceptions across all 99,409 subframes. |
| 16 | u32 | `0x0332044E` | **[C]** The seed for the record-area integrity word (§5.2.1). |

> **The "second clock" is not a clock.** Read as arithmetic it looks like a
> receipt timestamp 4 h 01 m 00.03 s ahead of the first, jittering by ±4 cs.
> It is neither: it is the first clock XORed with the fixed constant
> `0x04010003`, which is exactly what produces that apparent offset (`+4` in the
> hours byte, `+1` in minutes, `+3` in centiseconds) and the apparent jitter
> (XOR on the seconds byte is not addition). It carries no information of its
> own. Do not read it as a time.

**Slot records:** 50 fixed records of 88 bytes, in slot order. See §5.4.

**Subframe trailer (72 B):**

| offset | size | meaning |
|---|---|---|
| 0 | u32 | **record-area integrity word** — see §5.2.1 **[C]** |
| 4 | 4 | `FF 00 00 00`, constant |
| 8 | 64 | `0x00010000, 0x00020000 … 0x00100000` — 16 u32, **identical in every subframe in the file** **[U]** |

#### 5.2.1 The record-area integrity word  **[C]**

```
trailer[0..4] = XOR of the 1,100 big-endian u32 words of the 4,400-byte
                record area, XOR 0x0332044E
```

The seed is the same constant the subframe header carries at offset 16.

Verified against **all 99,409 subframes of the specimen with zero exceptions**,
and 8,877 distinct record areas produced 8,877 distinct words with no collisions
between differing content.

> **Why this matters for writing.** A reader that ignores this field still parses
> the file correctly. A *writer* that ignores it produces a file that parses but
> no longer checks out — corruption that survives a round-trip unnoticed. Any
> edit to a record must maintain it.
>
> XOR is linear and every position field is u32-aligned within the record area,
> so the word can be maintained incrementally: on writing a word, XOR the old and
> new values into it. That is one operation per write instead of a re-scan of
> 4,400 bytes, and it makes an edit-then-undo restore the original bytes exactly,
> because XOR is its own inverse.

It is also the only whole-payload integrity check in the format, which makes it
the right tool for telling an intact recording from a corrupted one: a single
flipped byte anywhere in a record area is caught.

> The 72-byte region at the end of block 0's configuration area has the same
> shape but its leading word does **not** follow this rule for any span tested.
> Left as **[U]**.

### 5.3 Block 0's config region (16,332 B)  **[C]**

Block 0 replaces its first subframe with configuration:

```
0x0000  12       block header (magic 0x00000100 + start time)
0x000C  244      rest of the file header (§5.5)
0x0110  4,000    participant roster: 50 × 80 B (§5.6)
0x10B0  12,176   zero padding
0x3F90  72       a standard subframe trailer
0x3FD8  ...      first real subframe
```

### 5.4 Slot record (88 B)  **[C: framing] [U: most fields]**

| offset | type | meaning |
|---|---|---|
| 0 | u16 | **state**: `0x0000` = live sample, `0x0001`/`0x0002` = no data **[I]** |
| 2 | u16 | always 0 |
| 4 | u16 | `0x005A` (90) on slots that are ever live; `0x0000` on slots that never report **[U]** |
| 6 | u8 | per-slot status byte — **not derivable**, see note **[U]** |
| 7 | u8 | **slot index, 1–50.** Verified on all 4,970,450 records. |
| 8 | f32 | position component **X** — range-local frame **[I]** |
| 12 | f32 | position component **Y** **[I]** |
| 16 | f32 | position component **Z** (vertical) **[I]** |
| 20 | f32 | **[U]** — constant along straight legs, 2.4–150.5. Not heading, not speed. |
| 24 | f32 | **[U]** — monotonic with vertical rate; ~12.5 when level. Attitude- or flight-path-like. |
| 28 | f32 | **[U]** — oscillates ±50 with a several-second period. |
| 32 | 8×i16 | **[U]** — small integers. `i16[2]` (offset 36) correlates **+0.996** with d(Z)/dt. |
| 48 | 4×i16 | **[U]** — a second group of small signed integers. Non-zero in **87%** of live records and 0.1% of no-data ones, so this is live payload, not padding. |
| 56 | 20 | zero in every record observed **[U]** |
| 76 | 2 | `FFFF` when present **[U]** |
| 78 | 1 | varies (0x96, 0x86, 0x76, 0x92 …) **[U]** |
| 79 | 9 | zero in every record observed **[U]** |

When state ≠ 0 (no data), offsets 8 and 12 both carry the sentinel
`0x45F423F0` = **7812.4922f**, and the rest of the record is zero. **[C]**

> **Offset 6 must be stored, not regenerated.** It tracks the state word closely
> but is not a function of it. Across the specimen: state `0x0000` always pairs
> with `0x00`, state `0x0002` always with `0x33`, but state `0x0001` pairs with
> `0x6F` in 681,696 records, `0x66` in 618, `0x65` in 395 and `0x33` in one. An
> exporter that synthesizes it from the state word would corrupt roughly a
> thousand records per recording, so it is carried verbatim.

> **No-data records are not blank.** They carry the `0x45F423F0` sentinel in X
> and Y, and frequently retain values in the Z, `i16[0..7]`, `48..55` and `76..78`
> fields — the *same* field layout as a live record, left over from when the slot
> last reported, or from initialisation before it ever did. There is no
> differently-shaped message hiding in them (§10).

### 5.5 File header (272 B at file offset 0)  **[C: layout]**

| offset | size | value in specimen | meaning |
|---|---|---|---|
| 0 | u32 | `0x00000100` | magic / version **[I]** |
| 4 | u32 | 0 | |
| 8 | 4 | `HH MM SS CC` | mission start clock, to the centisecond |
| 12 | u32 | `0x20000FE2` | **[U]** |
| 16 | u32 | `0x04010003` | same constant as the subframe header |
| 20 | 4 | `HH MM SS 00` | the same start clock, whole seconds |
| 24 | 4 | `HH MM SS CC` | the second clock **[U]** |
| 28 | u32 | `0x0104003C` | **[U]** |
| 32 | 8 | `"MM/DD/YY"` | mission date, ASCII |
| 40 | u32 | `0x06060000` | **[U]** |
| 44 | u32 | `0x00010000` | **[U]** |
| 48 | 16 | `"D MMM YY "` | mission date, ASCII, NUL-padded |
| 64 | 200 | zero | |
| 256 | 8 | zero | |
| 264 | 8 | two u32 | **[U]** — fixed within a recording; not coordinates under any tested scaling |

### 5.6 Participant roster — 50 × 80 B at 0x0110  **[C]**

This is the editable track-identity table.

| offset | type | meaning |
|---|---|---|
| 0 | u16 | `0x0102` — record type/version, constant |
| 2 | u8 | slot index, 1–50 |
| 3 | u8 | **aircraft type code** **[I]** — see below |
| 4 | u16 | 324–743, unique per slot, loosely descending **[U]** — pod/TIU id? |
| 6 | u32 | `0x00000007`, constant **[U]** |
| 10 | u16 | slot index again, 1–50 |
| 12 | 8 | **aircraft id** — ASCII, NUL-padded; a 3–4 digit tail/mod-3 style number |
| 20 | 8 | **unit** — ASCII; a squadron designator |
| 28 | 20 | **callsign / flight** — ASCII; a flight callsign, sometimes suffixed per go |
| 48 | 32 | zero in all 50 records **[U]** |

> **Field-width caveat.** The longest callsign in the specimen was 9 bytes —
> including a **trailing space**, which is part of the value and must survive a
> round-trip. Bytes 37–79 are zero in every record, so the boundary between
> "callsign" and "reserved" is **not observable** here. The 20-byte width above
> is a safe *lower* bound for reading; when writing, JDDC truncates to 20 and
> leaves 48–79 untouched.

**Aircraft type code (offset 3)** **[I]** — exactly three distinct values
appeared, and they partition the roster along type lines:

| value | share of roster | likely type |
|---|---|---|
| `0x58` | one contiguous block of 20 slots | a strike fighter |
| `0x5F` | most of the remainder | a single-seat fighter |
| `0x62` | 3 scattered slots | the two-seat variant of the same |

The split is by aircraft, not by squadron: two adjacent slots with the *same*
squadron and the *same* callsign carry different codes, which is what makes
"type" the plausible reading and "unit" not. **Three observed values cannot
establish a code table**, and nothing in the file maps a code to a name. Treat
unrecognized values as opaque and preserve them.

**Specimen roster:** 50 slots configured, **2 ever report data**. The other 48
are declared but never instrumented — a normal state for a range recording where
most of the roster is pre-provisioned ahead of the day's flying.

---

## 6. Coordinate frame — what is and is not known

**[C]** Offsets 8/12/16 are a smooth 3-D Cartesian triple in a **range-local
frame**. They are not geodetic, not ECEF, and not any scaled-integer angle: an
exhaustive scan of the record over f32/f64/i32/u32/i16 in both endiannesses,
crossed with semicircle, 1e-3…1e-7, arcsecond and radian scalings, produced no
plausible latitude or longitude at any aligned offset.

**[C]** Offset 16 is the **vertical** channel. Two independent confirmations:
the parked value is constant at −610.25 across a 25-minute pre-flight and an
11-minute post-flight hold at the same spot; and `i16[2]` at offset 36 tracks
its derivative at r = +0.996.

**[C]** The full profile is legible end to end: parked at
`(3145.7, −4026.6, −610.5)` → taxi → climb → ~100 minutes of maneuvering with
Z ≈ 850–890 → descent → parked at the same point. Slots 1 and 2 are co-located
on the ground (separation < 0.1 units within a single parked stretch) and
~1,224 units apart in flight.

**[U] The scale factor is not resolved**, but it is bounded. Integrating the
path length over the 6,300 s airborne segment gives 5.0–5.4 units/s of average
ground speed; at a 300–450 kt sortie average that is **30–46 m per horizontal
unit**. An independent check on the operating area's size is less constraining
but not contradictory. Within that band, 30.48 m (100 ft) and 30.87 m
(1 arcsecond of latitude) are indistinguishable. The axis-isotropy test that
would separate them (angular units modulate apparent speed by cos 2θ at
cos 39.4° = 0.773) returned a 1.19 ratio in the direction predicted for
**angular** units against a predicted 1.29 — suggestive, not conclusive, and
confounded by real airspeed variation across legs.

**[C] The 10 Hz position stream is extrapolated between sparse fixes.** Within
a single second, consecutive 0.1 s deltas hold a constant value to four
significant figures for one to four seconds, then take one large step and settle
on a new constant. That is dead reckoning between position updates, not
10 Hz truth, and it is why per-sample speed is bimodal and why any speed-derived
unit estimate has to integrate over minutes rather than sample pairs.

**[C] Z does not share X/Y's unit.** Blocks 1869→1929 cover ΔXY = 166 units
against ΔZ = +837. A shared unit implies a 79° climb. The vertical scale is
roughly 1/10 to 1/30 of the horizontal one.

**The frame is a range-centred local tangent plane.** **[I]** Frame `(0,0,0)` is
a surveyed **range center** with its own latitude, longitude and altitude, and
X/Y/Z are offsets on the tangent plane there. The specimen is consistent with
this in every respect — the triple is Cartesian, isotropic in X/Y, and its
vertical channel is independent — but the center's coordinates are **not stored
in the file**. They are range-system configuration.

**[U] The frame origin is therefore unknown from the file alone.** JDDC takes it
as an explicit parameter (see §9) and marks every derived coordinate as an
assumption. Supplying the real range center is what turns these samples into
absolute positions; nothing else can.

**A range center would over-determine the scales, which is why it is worth
asking for.** With the origin pinned at frame `(0,0,0)`:

- the parked position, at frame `(3145.7, −4026.6, −611.0)`, must land on the
  known ramp. Its bearing from the center tests the axis convention, and its
  distance fixes the **horizontal** scale;
- the ramp's known elevation against `Z = −611.0` fixes the **vertical** scale
  independently, and so tests whether the two scales are the same number.

Current best evidence, from the specimen alone and **not** a substitute for the
above:

| Estimator | Implies |
|---|---|
| Operating-area extent, 7,174 × 10,139 units | ≈ 10 m per horizontal unit for a ~70 × 100 km range complex |
| Sustained fast segments, 20–25 units/s | ≈ 10 m per horizontal unit for 400–480 kt |
| 10 Hz climb-out: 225.7 units horizontal against 1,090.4 units of Z | vertical unit is **8–27× smaller** than the horizontal one — a 26° climb-out at 10 m and 1 m respectively |

**[C] There is a regime problem in the speed data that no unit resolves.** Over
the airborne phase, per-0.1 s horizontal displacement is bimodal: ~75% of samples
sit at 2.6–4.8 units/s and ~6% at 20–25 units/s, in sustained runs of up to 49
seconds. A single aircraft cannot vary ground speed sevenfold in sustained
flight, so one of the two modes is not true motion. Which one is unresolved, and
any speed-derived scale estimate inherits that ambiguity. Report it; do not
average across it.

---

## 7. Validation invariants

A reader can assert all of these; the specimen satisfies every one.

1. `rpt.blockCount` entries exist, contiguous, summing to the `.msnP5` size.
2. Block 0 is 56,772 B; all others 44,932 B.
3. Every subframe begins `00 00 04 52 04 01 00 03` (99,409/99,409).
4. Subframe header bytes 16–19 are `0x0332044E` (99,409/99,409).
5. Subframe trailer bytes 4–7 are `FF 00 00 00`; bytes 8–71 are byte-identical
   in every subframe (1 distinct value across the file).
6. Slot record byte 7 equals its slot index (4,970,450/4,970,450).
7. Consecutive subframe timestamps differ by exactly 10 cs — with **one**
   exception in the specimen: block 0's first two subframes carry the same
   clock, so a reader must tolerate a single duplicate rather than reject it.
8. Slot record state word ∈ {`0x0000`, `0x0001`, `0x0002`}.
9. **Every subframe's trailer word equals `XOR32(record area) ^ 0x0332044E`**
   (99,409/99,409). The strongest check available: it covers all 4,400 payload
   bytes.
10. Every subframe's header word at offset 12 equals the word at offset 8 XOR
    `0x04010003` (99,409/99,409).

---

## 8. Consequences for round-tripping

Because so much of the record is **[U]**, byte-exact export requires retaining
and replaying, verbatim:

- the 16,332-byte block-0 config region (minus the roster, which is editable),
- every 20-byte subframe header (both clocks, all three constants),
- every 72-byte subframe trailer (its leading counter/checksum especially),
- every **dead** slot record in full (offset 6 is not reconstructible),
- slot record bytes 20–87 of live records,
- participant record bytes 3–11 and 48–79,
- the `.teq` file, unmodified.

Editable without loss of fidelity: the roster's id / unit / callsign / type
fields, and the position triple of live slot records.

**Track colour is not in this format.** There is no colour, no symbol and no
force/side field anywhere in the roster or the records. JDDC stores display
colour in its own dataset metadata; it cannot round-trip into a `.msnP5`.

---

## 9. What JDDC does with this

- **Import** (`src/core/parsers/p5.ts`) — one dataset per live roster slot, so each
  track gets its own colour, label and visibility through the existing workspace
  display settings. Raw frame components are always kept as the `p5_x`, `p5_y`
  and `p5_z` channels, and the undecoded record fields as `p5_field_a/b/c` and
  `p5_int_2`, so nothing that was read is thrown away.
- **One frame anchor per recording, never per track.** Every track of a recording
  is placed through the same anchor, resolved from the first live sample of the
  whole file. Anchoring each track on its own first sample would slide them all
  onto one coordinate and erase the formation geometry between them — the thing a
  multi-ship recording exists to show.
- **Georeference** — supplied by the operator, not guessed from the file. The
  defaults are a plausible western-US range placement, nothing more, and are
  stated in an import warning on every load; every imported point carries the
  `p5_assumed_georeference` quality flag. Changing the georeference and
  rebuilding re-places the tracks without re-reading the file.
- **Edit** — the roster's callsign, aircraft id, unit and type code, and the
  position of any live sample.
- **Export** (`src/core/exporters/p5.ts`) — patches the source bytes and re-emits
  them with a regenerated `.rpt`, plus the `.teq` exactly as it came in. An export
  with no edits is **byte-identical across all three files**; this is asserted in
  `test/p5-format.ts` and was verified against the full 446 MB specimen through
  the same call the UI makes.
- **A track is only ever inverted through its own georeference.** Export reads the
  georeference each dataset records in its metadata and offers no override:
  inverting a track through a georeference it was not built with rewrites every
  sample in it under a mismatched transform, silently. Changing the georeference
  therefore means rebuilding the tracks first, and the UI refuses to export until
  that has happened.
- **The set stays a set** — dropping `.msnP5`, `.rpt` and `.teq` together pairs
  them by basename; the index is cross-checked against the layout derived from the
  recording, and a `.teq` whose start clock disagrees is flagged.
- **Not supported, by design** — creating a `.msnP5` from scratch, promoting a
  no-data record to live, or round-tripping track colour. All three would mean
  writing bytes whose meaning is listed as unknown above.

---

## 10. Static data / line-up updates — what this specimen shows  **[C]**

A P5 range sends *static data* during a live mission: the line-up, with each
aircraft's identity and attributes, and it can be re-sent to change them
mid-mission. A reader that processes only the initial line-up would miss those
changes. Tested directly against the specimen:

| Test | Result |
|---|---|
| Roster-record signature (`0x0102` … `0x00000007`) across the whole 446 MB | **exactly 50 hits, all inside block 0** |
| ASCII runs ≥ 4 chars anywhere in the file | 71,945 — **every one outside block 0 is a float byte pattern**, at exact subframe strides (`A=33` is 11.825f) |
| Mid-recording per-slot changes outside TSPI | 6,477, and **all** of them are the state word / byte 6 flipping between the same four values |
| No-data records carrying a differently-shaped message | none: they hold the sentinel plus the *same* field layout as a live record |
| Bytes in the 80-byte roster record that could hold a role or a colour | **none.** Bytes 0–36 are fully accounted for; bytes 37–79 are zero in all 50 records |

**For this recording: no static-data updates are present, and no role or colour
field exists anywhere in the roster.** The container leaves no room for one — every
byte region is framed and is either a constant, a clock, the integrity word, or
TSPI.

**What this does not establish.** One specimen cannot distinguish:

1. *no updates were sent* on this sortie (a 50-slot roster where 2 aircraft flew),
2. *updates were sent but this recording does not preserve them*, or
3. *block 0 holds the **final** line-up, rewritten in place* rather than the initial one.

Two things would discriminate. A recording where a callsign or type is **known**
to have changed mid-mission settles 1 against 2 and 3 immediately. And the
`.teq`: it is preallocated and empty here (§4), and its 220,000 bytes divide by
the 80-byte roster record exactly 2,750 times — 50 slots × 55 revisions. That is
**suggestive and nothing more**; 220,000 also divides by 4,400, 110 and 88, and a
weapons-event log would be just as empty on a sortie with no shots.

**What JDDC does.** It reads the block-0 roster, lets those fields be edited, and
reports the per-slot data-availability timeline so a gap is visible rather than
silent. It does **not** implement a static-update message: no such message has
ever been observed, and any layout would be invented.
