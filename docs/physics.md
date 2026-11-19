# The physics & maths behind Window Seat

This document walks through every step from a flight-tracker position report to
"you can see Mont Blanc 58 km away, slightly behind you".

## 1. Coordinates

* Positions are WGS-84 latitude/longitude. Altitudes are metres above mean sea level.
  Flightradar24 reports feet, so we multiply by 0.3048.
* Short-range geometry uses a **spherical earth** (R = 6 371 km). Over the
  ≤ 400 km ranges involved, the sphere differs from the ellipsoid by less than the
  accuracy of the input data. `geodesy.py` also has full WGS-84 ECEF/ENU transforms
  for the future 3D renderer.
* Directions are **azimuth** (clockwise from true north) and **elevation** (above
  the local horizontal, negative = looking down).

## 2. Aircraft attitude from tracking data

Trackers give position, altitude, ground speed *v* and track *χ*, but not where
the nose points. We estimate the attitude:

| Quantity | Estimate | Notes |
|---|---|---|
| Heading ψ | ψ ≈ χ (ground track) | Ignores the wind-correction (crab) angle, usually < 5° |
| Bank φ | tan φ = v·ω / g, with ω = dχ/dt | A coordinated (balanced) turn. Clipped to ±35° |
| Pitch θ | θ = γ + α, with γ = atan(v_z / v) | α ≈ 2.5° angle of attack in cruise |

The track is first resampled to a uniform time step. Then it is smoothed with a
moving average so that position noise doesn't turn into fake bank angles.

## 3. From window to world: rotation matrices

We use the aerospace **body frame**: x points to the nose, y to the right wing,
z down. A ray through a window at horizontal offset *a* (positive towards the
nose) and vertical offset *b* (positive up) is

```
right window:  d_body = ( sin a·cos b,  +cos a·cos b,  −sin b )
left window:   d_body = ( sin a·cos b,  −cos a·cos b,  −sin b )
```

It is rotated into the local North-East-Down frame with the 3-2-1 (yaw-pitch-roll)
direction-cosine matrix:

```
        ⎡ cθcψ   sφsθcψ − cφsψ   cφsθcψ + sφsψ ⎤
C_nb =  ⎢ cθsψ   sφsθsψ + cφcψ   cφsθsψ − sφcψ ⎥
        ⎣ −sθ        sφcθ             cφcθ     ⎦
```

Then `azimuth = atan2(E, N)` and `elevation = −asin(D)`. In a 20° right bank, the
right-window centre ray points 20° below the horizon and the left one 20° above.
Exactly as you experience it.

## 4. Window field of view

A window of width *w* and height *h*, seen from an eye at distance *d*, subtends

```
horizontal half-angle = atan(w / 2d)      vertical half-angle = atan(h / 2d)
```

A Boeing 737 window is about 25 × 36 cm. A window-seat eye sits about 35 cm from
it, which gives ≈ 40° × 54°. Each seat further from the window adds about 48 cm
to *d*, so a middle seat sees roughly half of that. For rows over the wing, rays
more than ~10° below the window centre are blocked.

## 5. Curvature and refraction: the effective earth

Light in the atmosphere bends slightly towards the ground, following a curve of
about k/R with **k ≈ 0.13**. The standard trick is to replace the earth with a
bigger *effective earth*. On it, light travels in straight lines:

```
R' = R / (1 − k)  ≈ 1.15 R
```

Horizon distance and dip from height *h*:

```
d_horizon = R' · acos(R' / (R' + h))  ≈ √(2 R' h)
dip       = acos(R' / (R' + h))
```

At 37 000 ft (11.3 km) the geometric horizon is 379 km. Refraction pushes it to
406 km, and it sits 3.2° below the horizontal. Run `windowseat horizon 37000 --ft`.

## 6. Ray casting to the ground

In the vertical plane of the ray, put the earth's centre at the origin and the
observer at (0, R' + h). The ray then follows P(s) = P₀ + s·(cos ε, sin ε):

```
height above ground     a(s) = |P(s)| − R'
ground (arc) distance   g(s) = R' · atan2(s cos ε, R' + h + s sin ε)
```

* **Flat terrain:** solve |P(s)| = R' for the closed-form ray–sphere intersection.
* **With a DEM** (`--terrain`): march along *s*, sampling the elevation at the
  point reached by travelling g(s) along the azimuth, until a(s) ≤ terrain. Then
  refine with bisection. Steps grow with distance and shrink when the ray is
  close to the ground.

Rays that never reach the ground (above the horizon, or past the visibility
limit) are cut off at the horizon or visibility distance. The window's 4 edges
are sampled this way, and the results form the **footprint polygon** on the map.

## 7. Can I see that mountain?

For each landmark at ground distance *D*:

1. **Range:** D ≤ visibility. Also D ≤ √(2R'h_obs) + √(2R'h_target), because a
   4.8 km summit can be seen from ~265 km further than a sea-level town.
2. **Curvature:** the straight chord between observer and target on the effective
   earth must not pass below its surface.
3. **Apparent direction:** the elevation angle is atan2(r₂cos γ − r₁, r₂ sin γ),
   where γ = D / R'. Rotate (azimuth, elevation) into the body frame with Cᵀ and
   check that the offsets fall inside the window aperture.
4. **Terrain:** with a DEM, a ray-march towards the target must not hit a ridge first.

### 7b. Haze vs. clean air: why you can see Everest from 400 km

A single "visibility" number treats the atmosphere as uniformly hazy, which is
wrong at altitude. Following Koschmieder, an object of inherent contrast C₀
stays visible while C₀·e^(−τ) ≥ 2 %. Here τ is the optical depth along the
sight line, and the extinction coefficient falls off with height in two layers:

```
β(h) = 0.0116 km⁻¹ · e^(−h/8.4 km)        Rayleigh (air molecules, 550 nm)
     + β_A0        · e^(−h/1.5 km)        aerosol haze, β_A0 = 3.912/V − 0.0116
```

Cities and lakes are on the ground, so their sight line ends in the haze and
the plain visibility V applies. For summits, τ is integrated along the actual
sight line on the effective earth and compared with ln(C₀/0.02). We use C₀ ≈ 0.6
for snow or rock against the sky, which gives τ_max ≈ 3.4. For example, from
FL410, Everest at 394 km gives τ ≈ 1.6: about 20 % of its contrast survives.

### 7c. Alpenglow: summits see the sun first

A point at height H sees the sun when the sun's elevation is above
−(dip(H) + 0.83°). The 0.83° is horizon refraction plus the sun's
semi-diameter. For Everest's 8 849 m, dip ≈ 2.8°, so the summit turns pink
about 15 minutes before sunrise in the valleys. Each sighting is tagged with the
target's own lighting: *sunlit*, *alpenglow*, *twilight* or *dark*.

## 8. The sun

Solar azimuth and elevation come from the NOAA / Meeus low-precision algorithm
(error about 0.01°). From altitude the sun is still up while it is below the
local horizontal, as long as it is above the horizon dip. That is why sunset
comes several minutes later at cruise altitude than on the ground.

For each side we record:

* minutes with the sun on that side, from the sign of its body-frame y-component
* minutes with the sun inside the window aperture, meaning glare

## 9. The 3D window camera

The web viewer's 3D mode reuses the same rotation. The camera direction is the
window ray d_body, and the camera "up" is the cabin ceiling direction (−z_body)
with its component along d removed. Both are rotated with C_nb into NED, then
reordered to ENU, then taken into Earth-fixed coordinates with Cesium's
east-north-up frame at the aircraft position. The vertical field of view is
2·atan(h / 2d), so leaning closer (smaller d) widens the view, exactly as in
the cabin.

## 10. Known simplifications / ideas for contributors

* Crab angle: a crosswind makes the nose point a few degrees off the track.
  This could be estimated from wind data (e.g. GFS winds at flight level).
* Atmospheric visibility is one fixed number. A Koschmieder-style extinction
  model (V = 3.912/β) driven by weather data would be more realistic.
* Clouds are not modelled. Satellite cloud masks could be added.
* Window positions don't line up exactly with seat rows. Per-aircraft seat maps
  would refine the wing-blocking model.
* 3D view: CesiumJS renders terrain and lighting, but it doesn't model the
  alpenglow or the haze optics described above. The labels it shows come from
  this physics model, not from what Cesium happens to render.
