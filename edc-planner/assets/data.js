// EDC Orlando 2026 — Tinker Field — set times transcribed from the official day posters.
// All times are PM; "12:00" means midnight. Format: [artist, start, end, genre, note]
window.EDC = {
  year: 2026,
  stages: [
    { id: "kinetic", name: "Kinetic Field", short: "Kinetic", vibe: "Mainstage • EDM / Big Room", color: "#b44dff" },
    { id: "circuit", name: "Circuit Grounds", short: "Circuit", vibe: "Bass • Dubstep • Trap", color: "#29c6ff" },
    { id: "neon", name: "Neon Garden", short: "Neon", vibe: "Techno • House", color: "#39ff6a" },
    { id: "stereo", name: "Stereo Bloom", short: "Stereo", vibe: "House • Tech House", color: "#ff3fa4" }
  ],
  days: [
    {
      id: "fri", label: "Fri", name: "Friday Nov 6", date: "2026-11-06", poster: "img/friday.jpg",
      sets: {
        kinetic: [
          ["Zack Martino", "1:00", "2:25", "Progressive House"],
          ["JOA", "2:25", "3:25", "Electro House"],
          ["Hayla", "3:25", "4:25", "Melodic Bass"],
          ["Pegassi", "4:25", "5:28", "Future House"],
          ["Alesso", "5:28", "6:44", "Progressive House", "Sunset"],
          ["Kream", "6:47", "7:57", "House / Tech House"],
          ["Afrojack", "8:00", "9:10", "Big Room / EDM"],
          ["Mau P", "9:13", "10:28", "Tech House"],
          ["David Guetta", "10:31", "11:57", "Mainstage / EDM"]
        ],
        circuit: [
          ["Sloth", "1:00", "2:15", "Bass / Experimental"],
          ["Benda b2b Vastive", "2:15", "3:30", "Dubstep / Bass"],
          ["Big Florida", "3:30", "4:30", "Bass House"],
          ["Kompany", "4:30", "5:30", "Dubstep"],
          ["Adventure Club", "5:30", "6:30", "Melodic Bass", "Sunset"],
          ["Bou b2b Kanine", "6:30", "7:30", "Drum & Bass"],
          ["Level Up", "7:30", "8:30", "Dubstep"],
          ["Whethan", "8:30", "9:35", "Future Bass"],
          ["Levity", "9:35", "10:45", "Bass House"],
          ["Wooli", "10:45", "12:00", "Dubstep"]
        ],
        neon: [
          ["Matthias", "1:00", "3:00", "Techno"],
          ["Inbal", "3:00", "4:30", "Techno"],
          ["Azzeca", "4:30", "6:00", "Techno"],
          ["Obskür", "6:00", "7:30", "Techno", "Sunset"],
          ["Omar+", "7:30", "9:00", "Techno"],
          ["Brunello", "9:00", "10:30", "Techno"],
          ["Josh Baker", "10:30", "12:00", "Tech House"]
        ],
        stereo: [
          ["Raje", "1:00", "2:15", "House"],
          ["AAT", "2:15", "3:30", "Tech House"],
          ["Idemi", "3:30", "4:30", "House"],
          ["Joshwa", "4:30", "5:30", "Tech House"],
          ["Malugi", "5:30", "6:45", "Deep House"],
          ["Bullet Tooth b2b Sidney Charles", "6:45", "8:00", "Minimal / Deep House"],
          ["Interplanetary Criminal", "8:00", "9:15", "UK Garage / House"],
          ["MPH", "9:15", "10:30", "House"],
          ["Chris Lorenzo", "10:30", "12:00", "Bass House"]
        ]
      }
    },
    {
      id: "sat", label: "Sat", name: "Saturday Nov 7", date: "2026-11-07", poster: "img/saturday.jpg",
      sets: {
        kinetic: [
          ["Monoky", "1:00", "1:33", "House"],
          ["Me N Ü", "1:33", "2:33", "House"],
          ["Twinsick", "2:33", "3:33", "House"],
          ["Aaron Hibell", "3:33", "4:33", "Tech House"],
          ["Acraze b2b CID", "4:33", "5:38", "Bass House"],
          ["Alan Walker", "5:38", "6:53", "Progressive House", "Sunset"],
          ["Nico Moreno", "6:57", "8:02", "Techno"],
          ["Steve Aoki", "8:05", "9:10", "Electro House"],
          ["Disco Lines", "9:13", "10:28", "Tech House"],
          ["Kaskade", "10:31", "11:57", "Progressive House"]
        ],
        circuit: [
          ["Fury with MC Dino", "1:00", "2:30", "Drum & Bass"],
          ["MADVKTM", "2:30", "3:30", "Bass House"],
          ["Subsonic", "3:30", "4:30", "Bass"],
          ["Avello", "4:30", "5:30", "Dubstep"],
          ["JKYL & HYDE", "5:30", "6:30", "Bass House"],
          ["Layz", "6:30", "7:30", "Dubstep"],
          ["Alleycvt", "7:30", "8:30", "Dubstep"],
          ["Ray Volpe", "8:30", "9:35", "Dubstep"],
          ["Skull Machine", "9:35", "10:45", "Bass / Hybrid", "Black Tiger Sex Machine x Kai Wachi"],
          ["Alison Wonderland", "10:45", "12:00", "Trap / Bass"]
        ],
        neon: [
          ["Mai Iachetti", "1:00", "2:30", "Techno"],
          ["Kinahau", "2:30", "4:00", "Techno"],
          ["Miguelle & Tons", "4:30", "5:30", "Techno"],
          ["Luke Dean b2b George Smeddles", "5:30", "7:00", "Tech House", "Sunset"],
          ["Rossi.", "7:00", "8:30", "Techno"],
          ["Dennis Cruz", "8:30", "10:00", "Tech House"],
          ["Franky Rizardo", "10:00", "12:00", "Tech House"]
        ],
        stereo: [
          ["Alves", "1:00", "2:30", "Deep House"],
          ["Gabbs", "2:30", "3:30", "House"],
          ["Greg 99", "3:30", "4:30", "House"],
          ["Fallon", "4:30", "5:30", "Tech House"],
          ["Devault", "5:30", "6:45", "Melodic House", "Sunset"],
          ["Discip", "6:45", "8:00", "House"],
          ["Roddy Lima", "8:00", "9:15", "Techno"],
          ["Ayybo", "9:15", "10:30", "Techno"],
          ["Chasewest", "10:30", "12:00", "House"]
        ]
      }
    },
    {
      id: "sun", label: "Sun", name: "Sunday Nov 8", date: "2026-11-08", poster: "img/sunday.jpg",
      sets: {
        kinetic: [
          ["Esse", "1:00", "2:35", "House"],
          ["AR/CO", "2:35", "3:35", "Progressive House"],
          ["Jessica Audiffred", "3:35", "4:45", "Dubstep"],
          ["Ian Asher", "4:35", "5:35", "Future House"],
          ["Slander", "5:35", "6:51", "Bass / Melodic Dubstep"],
          ["I Hate Models", "6:54", "7:59", "Hard Techno"],
          ["Alok", "8:02", "9:12", "Big Room / EDM"],
          ["Hardwell", "9:15", "10:25", "Mainstage / EDM"],
          ["Martin Garrix", "10:28", "11:57", "Progressive / EDM"]
        ],
        circuit: [
          ["Discovery Project", "1:10", "2:25", "Emerging Artists"],
          ["A Little Sound", "2:25", "3:25", "Drum & Bass"],
          ["Kaivon", "3:25", "4:35", "Melodic Bass"],
          ["San Holo", "4:35", "5:25", "Future Bass", "Wholesome Riddim Set"],
          ["Of The Trees", "5:25", "6:40", "Experimental Bass", "Sunset"],
          ["Meduza", "6:40", "7:45", "House"],
          ["Maddix", "7:45", "8:45", "Big Room / Techno"],
          ["Deorro b2b Diesel", "8:45", "9:50", "Electro House"],
          ["Atliens", "9:50", "10:55", "Dubstep / Trap"],
          ["Holy Priest", "10:55", "12:00", "Hard Techno"]
        ],
        neon: [
          ["Ultrathem", "1:00", "3:00", "Techno"],
          ["SHDW", "3:00", "4:30", "Techno"],
          ["Adrián Mills", "4:30", "6:00", "Techno"],
          ["Marlon Hoffstadt", "6:00", "7:30", "House", "Sunset"],
          ["Boys Noize b2b Brutalismus", "7:30", "9:00", "Techno"],
          ["KI/KI", "9:00", "10:30", "Techno"],
          ["Klangkuenstler", "10:30", "12:00", "Hard Techno"]
        ],
        stereo: [
          ["M81", "1:00", "2:10", "House"],
          ["CØNTRA", "2:10", "3:10", "Tech House"],
          ["Chef Boyarbeatz", "3:10", "4:10", "House"],
          ["PHRVA", "4:10", "5:10", "House"],
          ["Sippy", "5:10", "6:15", "House"],
          ["Know Good", "6:15", "7:20", "Tech House"],
          ["Taiki Nulight", "7:20", "8:30", "UK Garage / House"],
          ["Ravenscoon", "8:30", "9:40", "House"],
          ["Boogie T", "9:40", "10:50", "Dubstep"],
          ["TroyBoi", "10:50", "12:00", "Trap / Global Bass"]
        ]
      }
    }
  ],
  // Stage pin positions on img/map.jpg (fraction of width/height of the 1080x1350 map).
  mapPins: {
    kinetic: [0.635, 0.535],
    circuit: [0.165, 0.375],
    neon: [0.84, 0.455],
    stereo: [0.22, 0.585]
  },
  entrance: [0.765, 0.35],
  // Rough walking minutes between stages at a normal festival pace (crowds included).
  walk: {
    "kinetic-circuit": 12, "kinetic-neon": 6, "kinetic-stereo": 9,
    "circuit-neon": 15, "circuit-stereo": 5, "neon-stereo": 14
  }
};
