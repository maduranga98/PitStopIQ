// ── Default inspection checklist ─────────────────────────────────────────────
//
// Shipped as constants and COPIED into each center's own template
// (inspectionTemplates/default) the first time the module is enabled. After
// that the center's copy is theirs: product edits to this file never overwrite
// it — they only bump DEFAULTS_VERSION so a future "new defaults available"
// prompt could be offered.
//
// ids are STABLE and are what reports, snapshots and "restore removed
// defaults" key on. Never rename or reuse one; to retire an item, delete it
// from a future version and leave existing copies alone.

export const DEFAULTS_VERSION = 1;

export interface DefaultChecklistSection {
  /** Stable. Also used as the template section id. */
  id: string;
  title: string;
  /** Hidden in a center's fresh copy (Hybrid Components). */
  hiddenByDefault?: boolean;
  /** [slug, label] — the item id is `${section.id}__${slug}`. */
  items: ReadonlyArray<readonly [slug: string, label: string]>;
}

export const DEFAULT_CHECKLIST: ReadonlyArray<DefaultChecklistSection> = [
  {
    id: "operational",
    title: "Operational Test",
    items: [
      ["engine_noise", "No abnormal engine noise"],
      ["operating_temp", "Engine reaches normal operating temperature"],
      ["cooling_fan", "Engine fan / radiator fan works"],
      ["brake_pedal", "Brake pedal free play and travel normal"],
      ["seat_belt", "Seat belt condition and operation"],
      ["steering_feel", "Steering feel, lock to lock"],
      ["steering_centered", "Steering wheel centered when driving straight"],
      ["tilt_steering", "Tilt steering adjustment works"],
      ["wipers_washer", "Washer fluid, wipers and washer operation"],
      ["gearbox_diff_oil", "Gearbox, transfer case and differential oil levels"],
      ["transmission_clutch", "Transmission / clutch operates smoothly"],
      ["heater_plugs", "Heater plugs (diesel only)"],
    ],
  },
  {
    id: "underbody",
    title: "Frame, Structure and Underbody",
    items: [
      ["steering_linkage", "Steering rack, linkage and control arms"],
      ["transmission_leaks", "Transmission case and pan for leaks"],
      ["belts_hoses", "Drive belts and hoses"],
      ["tires", "Tires: defects, damage and inflation"],
      ["brakes_lines", "Brakes, calipers, lines and hoses"],
      ["wheel_bearings", "Front and rear wheel bearings (including bearing noise)"],
      ["struts_shocks", "Struts and shocks: leaks and wear"],
      ["exhaust", "Exhaust system and hangers"],
      ["engine_mounts", "Engine mounts and bushings"],
      ["cv_joints", "CV joints and rubber boots"],
      ["fluid_leaks", "Fuel, oil, coolant or other fluid leaks"],
      ["chassis_frame", "Chassis frame: repair or bend marks"],
    ],
  },
  {
    id: "underhood",
    title: "Under Hood",
    items: [
      ["spark_plugs", "Spark plugs (if applicable)"],
      ["air_filter", "Engine air filter"],
      ["battery", "Battery condition (with battery tester)"],
      ["fluid_levels", "Engine oil, brake, clutch and power steering fluid levels"],
      ["coolant", "Coolant condition (e.g. mixed with water)"],
      ["ac_cooling", "A/C cooling and blower"],
      ["cabin_filter", "A/C / cabin air filter"],
    ],
  },
  {
    id: "body",
    title: "Body and Exterior",
    items: [
      ["accident_marks", "Accident or repair marks"],
      ["repainted", "Repainted panels"],
      ["panel_alignment", "Panel alignment (bumpers, fenders, bonnet)"],
      ["headlamps_body", "Headlamps: damage or repair marks"],
      ["glass", "Windscreen and glass (cracks, chips)"],
      ["side_mirrors", "Side mirrors (including mirror noise)"],
      ["tailgate", "Tailgate / boot lifter"],
      ["accessories", "Non-original accessories (audio, alloy wheels, DVR etc.)"],
    ],
  },
  {
    id: "functional",
    title: "Functional and Walkaround",
    items: [
      ["warning_lights", "Warning lights"],
      ["horn", "Horn"],
      ["headlights", "Headlights"],
      ["tail_lights", "Tail lights"],
      ["brake_lights", "Brake lights"],
      ["instrument_light", "Instrument illumination"],
      ["turn_signals", "Turn signals and self-cancel"],
      ["power_windows", "Power windows and master switch"],
    ],
  },
  {
    id: "scan",
    title: "Electronic Scan / Diagnosis",
    items: [
      ["all_scanned", "All systems scanned"],
      ["dtcs", "Fault codes (DTCs) found or none"],
      ["engine_trans_ecu", "Engine and transmission control"],
      ["abs", "ABS"],
      ["srs", "SRS / airbags"],
      ["power_steering_ecu", "Power steering control"],
      ["immobilizer", "Immobilizer"],
      ["ac_module", "Air conditioning control module"],
      ["info_display", "Multi-information display"],
      ["memory_erased", "Fault memory erased / recalibration done (if needed)"],
    ],
  },
  {
    id: "hybrid",
    title: "Hybrid Components",
    hiddenByDefault: true,
    items: [
      ["inverter_coolant", "Inverter coolant level"],
      ["hv_soc", "HV battery state of charge"],
      ["hv_transaxle", "HV transaxle trouble codes / operation"],
      ["aux_battery", "12V auxiliary battery"],
      ["hv_ecu", "HV ECU"],
    ],
  },
];

/** The section a diagnostic report uses as its quick-check list. */
export const DIAGNOSTIC_QUICK_CHECK_SECTION_ID = "scan";

/** `__` not `.`: ids are used as Firestore map keys in dotted update paths
 *  (`results.<id>.status`), where a dot would split the key. */
export const defaultItemId = (sectionId: string, slug: string) => `${sectionId}__${slug}`;
