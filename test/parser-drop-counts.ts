// GPX and KML used to skip unparseable coordinates with no record of any kind:
// a malformed file looked identical to a short one. These assertions exist so
// that a silent drop cannot be reintroduced without failing here.

// The parsers use the browser's DOMParser and rely on the namespace-agnostic
// getElementsByTagName('*') form, which linkedom returns empty for; the shared
// shim patches both for Node.
import './helpers/linkedomShim.ts'

import { parseGpx } from '../src/core/parsers/gpx.ts'
import { parseKml } from '../src/core/parsers/kml.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// ------------------------------------------------------------------------ GPX

// Five trkpts, two of which carry a lat or lon that will not parse.
const gpx = `<?xml version="1.0"?>
<gpx version="1.1" creator="test-suite">
  <trk><trkseg>
    <trkpt lat="40.0" lon="-75.0"><ele>100</ele></trkpt>
    <trkpt lat="not-a-number" lon="-75.1"><ele>101</ele></trkpt>
    <trkpt lat="40.2" lon="-75.2"><ele>102</ele></trkpt>
    <trkpt lat="40.3"><ele>103</ele></trkpt>
    <trkpt lat="40.4" lon="-75.4"><ele>104</ele></trkpt>
  </trkseg></trk>
</gpx>`

const gpxResult = parseGpx(gpx)
check('GPX keeps the parseable points', gpxResult.points.length === 3, `${gpxResult.points.length}`)
check('GPX counts the dropped elements', gpxResult.droppedCounts?.invalidCoordinate === 2, JSON.stringify(gpxResult.droppedCounts))
check('GPX also warns in prose', gpxResult.warnings.some((warning) => warning.includes('unparseable')), gpxResult.warnings.join(' | '))
check('Kept plus dropped equals what the file offered', gpxResult.points.length + (gpxResult.droppedCounts?.invalidCoordinate ?? 0) === 5)

const cleanGpx = parseGpx(`<?xml version="1.0"?>
<gpx version="1.1"><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>`)
check('A clean GPX reports no drop counts at all', cleanGpx.droppedCounts === undefined, JSON.stringify(cleanGpx.droppedCounts))
check('A clean GPX adds no drop warning', !cleanGpx.warnings.some((warning) => warning.includes('unparseable')))

// ------------------------------------------------------------------------ KML

// A <coordinates> block with two unusable tuples among four.
const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark><name>Route</name><LineString><coordinates>
    -75.0,40.0,100
    bad,40.1,101
    -75.2,40.2,102
    -75.3,nope,103
  </coordinates></LineString></Placemark>
</kml>`

const kmlResult = parseKml(kml)
check('KML keeps the parseable tuples', kmlResult.points.length === 2, `${kmlResult.points.length}`)
check('KML counts the dropped tuples', kmlResult.droppedCounts?.invalidCoordinate === 2, JSON.stringify(kmlResult.droppedCounts))
check('KML also warns in prose', kmlResult.warnings.some((warning) => warning.includes('unparseable')), kmlResult.warnings.join(' | '))

// The gx:Track path is a separate loop and was separately silent.
//
// Written without the `gx:` prefix on purpose. The parser matches on
// `localName`, which a real browser DOMParser resolves to `Track`/`coord`
// regardless of prefix; linkedom does not do namespace resolution and leaves
// `localName` as the literal `gx:coord`, so a prefixed fixture would exercise
// linkedom's limitation rather than this parser. Same class of test-environment
// gap the wildcard-getElementsByTagName shim exists for.
const kmlTrack = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark><name>Sortie</name><Track>
    <when>2023-11-14T22:13:20Z</when><coord>-75.0 40.0 100</coord>
    <when>2023-11-14T22:13:21Z</when><coord>oops 40.1 101</coord>
    <when>2023-11-14T22:13:22Z</when><coord>-75.2 40.2 102</coord>
  </Track></Placemark>
</kml>`

const trackResult = parseKml(kmlTrack)
check('KML gx:Track keeps the parseable coords', trackResult.points.length === 2, `${trackResult.points.length}`)
check('KML gx:Track counts its dropped coords', trackResult.droppedCounts?.invalidCoordinate === 1, JSON.stringify(trackResult.droppedCounts))

const cleanKml = parseKml(`<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><Point><coordinates>-75,40,10</coordinates></Point></Placemark></kml>`)
check('A clean KML reports no drop counts at all', cleanKml.droppedCounts === undefined, JSON.stringify(cleanKml.droppedCounts))

console.log(`\n${failures === 0 ? 'ALL PARSER DROP COUNT CHECKS PASSED' : `${failures} PARSER DROP COUNT CHECK(S) FAILED`}`)
if (failures > 0) process.exit(1)
