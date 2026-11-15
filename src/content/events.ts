/**
 * The events shown in the app. Each sets a real moment, the best places on the Moon to watch it from,
 * a "before → event → after" sequence, and plain explanations for teachers and students.
 */
import type { EventDef, L10n } from '../core/types';

const BEFORE: L10n = { tr: 'ÖNCE', en: 'BEFORE' };
const DURING: L10n = { tr: 'OLAY', en: 'EVENT' };
const AFTER: L10n = { tr: 'SONRA', en: 'AFTER' };
/** Moments one sidereal month apart see the same stars in the same place from the same lunar site. */
const SIDEREAL_MONTH_DAYS = 27.321661;

export const EVENTS: EventDef[] = [
  {
    id: 'apollo11',
    order: 1,
    category: 'mission',
    title: { tr: 'Apollo 11: İnsanın Ay’a İlk İnişi', en: 'Apollo 11: The First Crewed Moon Landing' },
    dateLabel: { tr: '20–21 Temmuz 1969', en: '20–21 July 1969' },
    summary: {
      tr: 'Eagle’ın Sükûnet Denizi’ne inişini, Ay yürüyüşünü ve kalkışı iniş yerinden izleyin. Sonra geride kalan araçların arasında dolaşın.',
      en: 'Watch Eagle land on the Sea of Tranquility, the moonwalk and the lift-off from the landing site. Then walk among what was left behind.',
    },
    about: [
      {
        tr: '20 Temmuz 1969’da Neil Armstrong ve Buzz Aldrin, Ay Modülü Eagle ile Sükûnet Denizi’ne (Mare Tranquillitatis) indi. Üçüncü astronot Michael Collins bu sırada komuta modülü Columbia ile Ay’ın çevresinde dolanıyordu. İniş 20:17:40 UT’de gerçekleşti.',
        en: 'On 20 July 1969 Neil Armstrong and Buzz Aldrin landed the lunar module Eagle on the Sea of Tranquility (Mare Tranquillitatis). The third astronaut, Michael Collins, was orbiting the Moon in the command module Columbia. Touchdown came at 20:17:40 UT.',
      },
      {
        tr: 'Astronotlar yaklaşık iki buçuk saat Ay yüzeyinde yürüdü. Bayrak diktiler; bir televizyon kamerası, bir sismometre ve bir lazer yansıtıcı kurdular. 21 Temmuz’da Eagle’ın üst kısmı (kalkış kademesi) havalandı; alt kısmı (iniş kademesi) rampa olarak yerinde kaldı.',
        en: 'The astronauts walked on the surface for about two and a half hours. They planted a flag and set up a television camera, a seismometer and a laser reflector. On 21 July the upper part of Eagle (the ascent stage) lifted off; the lower part (the descent stage) stayed behind as its launch pad.',
      },
      {
        tr: 'Ay’da hava, rüzgâr ve yağmur olmadığı için geride kalanlar bugün de yerinde duruyor. Lazer yansıtıcı hâlâ kullanılıyor: Dünya’dan gönderilen lazer ışığını geri yansıtarak Ay’ın uzaklığının milimetre düzeyinde ölçülmesini sağlıyor.',
        en: 'With no air, wind or rain on the Moon, what was left behind is still there. The laser reflector is still in use: it sends laser light from Earth straight back, so the Moon’s distance can be measured to the millimetre.',
      },
    ],
    date: { year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 40 },
    startRate: 1,
    staging: [{
      where: 'surface',
      focusId: 'a11_descent',
      endRate: 1,
      stages: [
        {
          id: 'a11_empty', kind: 'before', label: BEFORE, seconds: 6, focusGround: true, zoomFovDeg: 30,
          from: { date: { year: 1969, month: 7, day: 20, hour: 20, minute: 15, second: 30 } },
          to: { date: { year: 1969, month: 7, day: 20, hour: 20, minute: 16 } },
          caption: {
            tr: '20 Temmuz 1969, 20:15 UT. Sükûnet Denizi henüz bomboş. Eagle birkaç dakika sonra 110 metre ötedeki düzlüğe inecek.',
            en: '20 July 1969, 20:15 UT. The Sea of Tranquility is still empty. In a few minutes Eagle will land on the plain 110 metres ahead.',
          },
        },
        {
          id: 'a11_descent', kind: 'event', label: DURING, seconds: 25, zoomFovDeg: 30,
          from: { date: { year: 1969, month: 7, day: 20, hour: 20, minute: 16 } },
          to: { date: { year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 41 } },
          caption: {
            tr: 'Eagle doğudan, alçaktaki Güneş’in önünden alçalıyor (4 kat hızda). Armstrong kayalık bir krateri geçip düz bir yer arıyor. Hava olmadığı için motorun savurduğu toz dümdüz çizgiler hâlinde yayılıyor.',
            en: 'Eagle comes down from the east, in front of the low Sun (4× speed). Armstrong flies past a boulder-strewn crater looking for level ground. With no air, the dust blown by the engine flies out in straight lines.',
          },
        },
        {
          id: 'a11_touchdown', kind: 'event', label: DURING, seconds: 20, focusGround: true, zoomFovDeg: 30,
          from: { date: { year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 41 } },
          caption: {
            tr: 'İniş: 20:17:40 UT. İnsanlar ilk kez başka bir gök cismine indi. Hava olmadığı için toz bulutu asılı kalmıyor, hemen yere düşüyor.',
            en: 'Touchdown: 20:17:40 UT. For the first time, people have landed on another world. With no air, no dust cloud hangs in the air; it falls straight back down.',
          },
        },
        {
          id: 'a11_eva', kind: 'after', label: AFTER, seconds: 16, cut: true, focusId: 'none',
          standAt: { x: 10, z: 30, headingDeg: 330 },
          from: { date: { year: 1969, month: 7, day: 21, hour: 2, minute: 50 } },
          to: { date: { year: 1969, month: 7, day: 21, hour: 5, minute: 15 } },
          caption: {
            tr: '21 Temmuz, 02:50–05:15 UT: Ay yürüyüşü (hızlandırılmış). Bot izleri ve astronotların kurduğu aletler birer birer beliriyor. Etrafınıza bakın.',
            en: '21 July, 02:50–05:15 UT: the moonwalk (sped up). The bootprints and the instruments the astronauts set up appear one by one. Look around.',
          },
        },
        {
          id: 'a11_liftoff', kind: 'after', label: AFTER, seconds: 16, cut: true, standAt: { x: 14, z: 40, headingDeg: 340 },
          from: { date: { year: 1969, month: 7, day: 21, hour: 17, minute: 53, second: 56 } },
          to: { date: { year: 1969, month: 7, day: 21, hour: 17, minute: 54, second: 12 } },
          caption: {
            tr: '21 Temmuz, 17:54 UT: kalkış kademesi havalanıyor (gerçek hızda). Motorun egzozu bayrağı deviriyor; iniş kademesi rampa olarak yerinde kalıyor.',
            en: '21 July, 17:54 UT: the ascent stage lifts off (real speed). Its exhaust knocks the flag over; the descent stage stays behind as the launch pad.',
          },
        },
        {
          id: 'a11_climb', kind: 'after', label: AFTER, seconds: 9, zoomFovDeg: 15,
          from: { date: { year: 1969, month: 7, day: 21, hour: 17, minute: 54, second: 12 } },
          to: { date: { year: 1969, month: 7, day: 21, hour: 17, minute: 54, second: 40 } },
          caption: {
            tr: 'Kalkış kademesi batıya dönerek yörüngedeki Columbia’ya doğru yükseliyor (hızlandırılmış).',
            en: 'The ascent stage turns west and climbs toward Columbia in orbit (sped up).',
          },
        },
        {
          id: 'a11_witnesses', kind: 'after', label: AFTER, seconds: 8, focusGround: true,
          from: { date: { year: 1969, month: 7, day: 21, hour: 17, minute: 54, second: 40 } },
          caption: {
            tr: 'Geride kalanlar: iniş kademesi, lazer yansıtıcı, sismometre ve bot izleri. Artık serbestçe dolaşabilirsiniz.',
            en: 'Left behind: the descent stage, the laser reflector, the seismometer and the bootprints. You can now walk around freely.',
          },
        },
      ],
    }],
    cues: [
      {
        id: 'a11_60s',
        at: { date: { year: 1969, month: 7, day: 20, hour: 20, minute: 16, second: 31 } },
        speaker: { tr: 'Charlie Duke (Houston)', en: 'Charlie Duke (Houston)' },
        text: { tr: '“Sixty seconds.” (Altmış saniye) — yakıt sınırına kalan süre.', en: '“Sixty seconds.” — time left before the fuel limit.' },
      },
      {
        id: 'a11_30s',
        at: { date: { year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 2 } },
        speaker: { tr: 'Charlie Duke (Houston)', en: 'Charlie Duke (Houston)' },
        text: { tr: '“Thirty seconds.” (Otuz saniye)', en: '“Thirty seconds.”' },
      },
      {
        id: 'a11_contact',
        at: { date: { year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 40 } },
        speaker: { tr: 'Buzz Aldrin', en: 'Buzz Aldrin' },
        text: { tr: '“Contact light.” (Temas ışığı) — ayakların altındaki çubuklar yere değdi.', en: '“Contact light.” — the probes under the footpads have touched the ground.' },
      },
      {
        id: 'a11_landed',
        at: { date: { year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 58 } },
        speaker: { tr: 'Neil Armstrong', en: 'Neil Armstrong' },
        text: {
          tr: '“Houston, Tranquility Base here. The Eagle has landed.” (Houston, burası Sükûnet Üssü. Kartal indi.)',
          en: '“Houston, Tranquility Base here. The Eagle has landed.”',
        },
      },
      {
        id: 'a11_step',
        at: { date: { year: 1969, month: 7, day: 21, hour: 2, minute: 56, second: 15 } },
        speaker: { tr: 'Neil Armstrong', en: 'Neil Armstrong' },
        text: {
          tr: '“That’s one small step for [a] man, one giant leap for mankind.” (Bu, bir insan için küçük, insanlık için dev bir adım.)',
          en: '“That’s one small step for [a] man, one giant leap for mankind.”',
        },
      },
      {
        id: 'a11_lift',
        at: { date: { year: 1969, month: 7, day: 21, hour: 17, minute: 54 } },
        text: {
          tr: 'Kalkış motoru çalıştı. Eagle, yüzeyde geçen 21,5 saatin ardından Columbia’ya dönüyor.',
          en: 'Ascent engine ignition. After 21.5 hours on the surface, Eagle heads back to Columbia.',
        },
      },
    ],
    defaultSiteId: 'apollo11',
    seenFrom: 'moon',
    recommendedSiteIds: ['apollo11', 'apollo15', 'apollo17'],
    primaryTargetId: 'earth',
    notes: [
      {
        tr: 'Gerçek: İniş, ilk adım ve kalkış saatleri NASA kayıtlarındaki saatlerdir. Güneş’in ve Dünya’nın gökteki yeri o ana göre hesaplanır.',
        en: 'Real: the touchdown, first-step and lift-off times are those in NASA’s records. The positions of the Sun and Earth in the sky are computed for that moment.',
      },
      {
        tr: 'Yaklaşık: Eagle’ın iniş ve kalkış yolu, telsiz konuşmalarına uydurulmuş basit bir eğridir. Aletlerin yerleri ve beliriş saatleri NASA’nın görev haritasına göre yaklaşıktır.',
        en: 'Approximate: Eagle’s descent and climb follow a simple path fitted to the radio calls. The positions of the instruments and the times they appear are approximate, based on NASA’s mission map.',
      },
    ],
    infoTopicIds: ['apollo11', 'lrrr', 'apollo_seismic', 'earth_from_moon'],
    accent: '#5fd4ff',
    cardTopicId: 'apollo11',
  },

  {
    id: 'sn1054',
    order: 2,
    category: 'supernova',
    title: { tr: '1054 Süpernovası ve Yengeç Bulutsusu', en: 'The Supernova of 1054 and the Crab Nebula' },
    dateLabel: { tr: '4 Temmuz 1054 · Jülyen takvimi', en: '4 July 1054 · Julian calendar' },
    summary: {
      tr: 'Boğa takımyıldızında bir gece birdenbire parlak bir yıldız belirdi ve 23 gün boyunca gündüz bile görüldü. Bu yıldızın ortaya çıkışını Ay’dan izleyin.',
      en: 'One night a brilliant new star appeared in Taurus and stayed visible even in daylight for 23 days. Watch it appear from the Moon.',
    },
    about: [
      {
        tr: '4 Temmuz 1054’te Çinli gökbilimciler Boğa takımyıldızında daha önce olmayan bir “konuk yıldız” kaydetti. Bu, yaklaşık 6.500 ışık yılı uzaklıktaki dev bir yıldızın patlamasıydı (süpernova). Işığı bize ulaştığında yıldız Venüs’ten bile parlaktı.',
        en: 'On 4 July 1054 Chinese astronomers recorded a “guest star” in Taurus where none had been before. It was the explosion of a massive star (a supernova) about 6,500 light years away. When its light arrived, it outshone even Venus.',
      },
      {
        tr: 'Patlamadan geriye kalan gaz bulutu bugün Yengeç Bulutsusu olarak bilinir ve hâlâ genişler. Merkezinde saniyede yaklaşık 30 kez dönen bir nötron yıldızı (pulsar) vardır.',
        en: 'The cloud of gas left by the explosion is known today as the Crab Nebula, and it is still expanding. At its centre is a neutron star (a pulsar) that spins about 30 times a second.',
      },
      {
        tr: 'Ay’da hava olmadığı için gökyüzü gündüz de siyahtır, ama Güneş’in parlaklığı gözü kamaştırır ve sönük yıldızları bastırır. Güneş gökteyse F tuşuyla elinizi Güneş’in önüne getirin. Teleskopla (T) yakınlaşıp yakın görünüme geçerseniz bulutsunun yüzyıllar içinde nasıl büyüdüğünü görebilirsiniz.',
        en: 'With no air, the Moon’s sky is black even by day, but the Sun’s glare still dazzles and drowns faint stars. If the Sun is up, hold F to raise a hand in front of it. Zoom in with the telescope (T) and open the close-up view to see the nebula grow over the centuries.',
      },
    ],
    date: { year: 1054, month: 7, day: 4, hour: 0, minute: 2 },
    startRate: 1,
    staging: [{
      where: 'surface',
      focusId: 'sn1054',
      autoSeat: true,
      endRate: 1,
      stages: [
        {
          id: 'sn54_before', kind: 'before', label: BEFORE, seconds: 6,
          from: { date: { year: 1054, month: 7, day: 3, hour: 20 } },
          to: { date: { year: 1054, month: 7, day: 3, hour: 23, minute: 59, second: 30 } },
          caption: {
            tr: '3 Temmuz 1054, Boğa takımyıldızı. İşaretli noktada henüz hiçbir yıldız yok.',
            en: '3 July 1054, the constellation Taurus. There is no star yet at the marked spot.',
          },
        },
        {
          id: 'sn54_light', kind: 'event', label: DURING, seconds: 10,
          from: { date: { year: 1054, month: 7, day: 3, hour: 23, minute: 59, second: 30 } },
          to: { date: { year: 1054, month: 7, day: 4, hour: 0, minute: 30 } },
          caption: {
            tr: 'Patlamanın ışığı ulaşıyor. Bu ışık 6.500 yıl önce yola çıktı. (Parlaklığın zamanla değişimi bir modeldir.)',
            en: 'The light of the explosion arrives. It set out 6,500 years ago. (How the brightness changes over time is a model.)',
          },
        },
        {
          id: 'sn54_rise', kind: 'event', label: DURING, seconds: 16,
          from: { date: { year: 1054, month: 7, day: 4, hour: 0, minute: 30 } },
          to: { date: { year: 1054, month: 7, day: 14 } },
          caption: {
            tr: 'Sonraki 10 gün (hızlandırılmış): yıldız Venüs’ten daha parlak hâle geliyor ve Güneş doğduktan sonra da siyah Ay göğünde görünmeye devam ediyor.',
            en: 'The next 10 days (sped up): the star becomes brighter than Venus and stays visible in the black lunar sky even after sunrise.',
          },
        },
        {
          id: 'sn54_after', kind: 'after', label: AFTER, seconds: 6,
          from: { date: { year: 1054, month: 7, day: 14 } },
          caption: {
            tr: 'En parlak hâli. 1054’te Dünya’dan 23 gün boyunca gündüz görüldü. Bilgi için E, teleskop için T tuşuna basın.',
            en: 'At its brightest. In 1054 it was seen from Earth in daylight for 23 days. Press E for information or T for the telescope.',
          },
        },
      ],
    }],
    defaultSiteId: 'copernicus',
    seenFrom: 'anywhere',
    recommendedSiteIds: ['copernicus', 'apollo11', 'tycho', 'von_karman'],
    primaryTargetId: 'sn1054',
    notes: [
      {
        tr: 'Gerçek: Yıldızın gökteki yeri, bugünkü Yengeç Bulutsusu’nun yeridir ve 1054 tarihli Çin kayıtlarıyla uyumludur.',
        en: 'Real: the star’s position is that of today’s Crab Nebula, in agreement with the Chinese records of 1054.',
      },
      {
        tr: 'Model: Parlaklığın gün gün değişimi tipik bir süpernova ışık eğrisinden alınmıştır. Yakın görünümdeki bulutsu, gerçek boyutuna göre ölçeklenmiş bir canlandırmadır.',
        en: 'Model: the day-by-day brightness follows a typical supernova light curve. The nebula in the close-up view is an illustration scaled to its real size.',
      },
    ],
    infoTopicIds: ['sn1054', 'casA'],
    accent: '#ff8a5b',
    cardTopicId: 'sn1054',
  },

  {
    id: 'sn1006',
    order: 3,
    category: 'supernova',
    title: { tr: '1006 Süpernovası: Tarihteki En Parlak Yıldız', en: 'The Supernova of 1006: The Brightest Star on Record' },
    dateLabel: { tr: '1 Mayıs 1006 · Jülyen takvimi', en: '1 May 1006 · Julian calendar' },
    summary: {
      tr: 'Mayıs 1006’da Kurt takımyıldızında beliren yıldız, kayıtlı tarihte görülen en parlak yıldızdı. Ortaya çıkışını Ay’dan izleyin.',
      en: 'The star that appeared in Lupus in May 1006 was the brightest ever recorded. Watch it appear from the Moon.',
    },
    about: [
      {
        tr: '1006 yılının Mayıs ayında Mısır’dan Çin’e, İsviçre’den Japonya’ya kadar pek çok yerde gökbilimciler güney göğünde yeni ve çok parlak bir yıldız gördü. Kahireli hekim ve gökbilimci İbn Rıdvan, bu yıldızın yere düşen ışığının Ay ışığının dörtte birinden biraz fazla olduğunu yazdı.',
        en: 'In May 1006 astronomers from Egypt to China and from Switzerland to Japan saw a new, very bright star in the southern sky. The Cairo physician and astronomer Ibn Ridwan wrote that the light it cast on the ground was a little more than a quarter of moonlight.',
      },
      {
        tr: 'Bu, yaklaşık 7.200 ışık yılı uzaklıkta bir beyaz cücenin patlamasıydı (Tip Ia süpernova). Kalıntısı bugün gökyüzünde dolunay büyüklüğünde, sönük bir halka olarak görünür.',
        en: 'It was the explosion of a white dwarf about 7,200 light years away (a type Ia supernova). Its remnant now appears as a faint ring as wide as the full Moon.',
      },
    ],
    date: { year: 1006, month: 5, day: 1, hour: 18 },
    startRate: 1,
    staging: [{
      where: 'surface',
      focusId: 'sn1006',
      autoSeat: true,
      endRate: 1,
      stages: [
        {
          id: 'sn06_before', kind: 'before', label: BEFORE, seconds: 6,
          from: { date: { year: 1006, month: 4, day: 30, hour: 18 } },
          to: { date: { year: 1006, month: 4, day: 30, hour: 23, minute: 59, second: 30 } },
          caption: {
            tr: '30 Nisan 1006, Kurt (Lupus) takımyıldızı. İşaretli noktada henüz bir yıldız yok.',
            en: '30 April 1006, the constellation Lupus. There is no star yet at the marked spot.',
          },
        },
        {
          id: 'sn06_light', kind: 'event', label: DURING, seconds: 8,
          from: { date: { year: 1006, month: 4, day: 30, hour: 23, minute: 59, second: 30 } },
          to: { date: { year: 1006, month: 5, day: 1, hour: 12 } },
          caption: {
            tr: 'Patlamanın ışığı ulaşıyor; 7.200 ışık yılı öteden geliyor. (Parlaklığın zamanla değişimi bir modeldir.)',
            en: 'The light of the explosion arrives, from 7,200 light years away. (How the brightness changes over time is a model.)',
          },
        },
        {
          id: 'sn06_rise', kind: 'event', label: DURING, seconds: 16,
          from: { date: { year: 1006, month: 5, day: 1, hour: 12 } },
          to: { date: { year: 1006, month: 5, day: 18 } },
          caption: {
            tr: 'Sonraki 17 gün (hızlandırılmış): yıldız Venüs’ün yaklaşık 15 katı parlaklığa ulaşıyor.',
            en: 'The next 17 days (sped up): the star becomes about 15 times brighter than Venus.',
          },
        },
        {
          id: 'sn06_after', kind: 'after', label: AFTER, seconds: 6,
          from: { date: { year: 1006, month: 5, day: 18 } },
          caption: {
            tr: 'En parlak hâli: kayıtlı tarihteki en parlak yıldız. Bilgi için E, teleskop için T tuşuna basın.',
            en: 'At its brightest: the brightest star on record. Press E for information or T for the telescope.',
          },
        },
      ],
    }],
    defaultSiteId: 'tycho',
    seenFrom: 'anywhere',
    recommendedSiteIds: ['tycho', 'chandrayaan3', 'apollo11', 'shackleton'],
    primaryTargetId: 'sn1006',
    notes: [
      {
        tr: 'Gerçek: Yıldızın gökteki yeri, bugünkü SN 1006 kalıntısının yeridir.',
        en: 'Real: the star’s position is that of today’s SN 1006 remnant.',
      },
      {
        tr: 'Model: En yüksek parlaklık (−7,5 kadir) tarihsel kayıtlardan tahmin edilmiştir; parlaklığın zamanla değişimi tipik bir Tip Ia ışık eğrisidir.',
        en: 'Model: the peak brightness (magnitude −7.5) is estimated from historical records; the change over time follows a typical type Ia light curve.',
      },
    ],
    infoTopicIds: ['sn1006', 'sn1572'],
    accent: '#ffd166',
    cardTopicId: 'sn1006',
  },

  {
    id: 'comet44bc',
    order: 4,
    category: 'comet',
    title: { tr: 'M.Ö. 44 Büyük Kuyruklu Yıldızı', en: 'The Great Comet of 44 BC' },
    dateLabel: { tr: '23 Temmuz M.Ö. 44 · Jülyen takvimi', en: '23 July 44 BC · Julian calendar' },
    summary: {
      tr: 'Julius Caesar’ın ölümünden birkaç ay sonra Roma’da, gün batmadan bile görülen parlak kuyruklu yıldızı Ay’dan izleyin.',
      en: 'Watch from the Moon the bright comet seen in Rome, even before sunset, a few months after Julius Caesar’s death.',
    },
    about: [
      {
        tr: 'M.Ö. 44 yılının Temmuz ayında, Julius Caesar’ın öldürülmesinden yaklaşık dört ay sonra, Roma’da onun anısına düzenlenen oyunlar sırasında gökyüzünde parlak bir kuyruklu yıldız görüldü. Kayıtlara göre gün batmadan yaklaşık bir saat önce bile görülebiliyordu. Aynı yıl Çin kayıtlarında da bir kuyruklu yıldızdan söz edilir.',
        en: 'In July 44 BC, about four months after Julius Caesar was assassinated, a bright comet appeared during the games held in his memory in Rome. According to the records it could be seen even about an hour before sunset. Chinese records from the same year also mention a comet.',
      },
      {
        tr: 'Kuyruklu yıldızlar buz ve tozdan oluşan küçük gök cisimleridir. Güneş’e yaklaştıklarında buzları buharlaşır ve iki kuyruk oluşur: Güneş rüzgârının ittiği düz, mavimsi gaz kuyruğu ve yörünge boyunca kıvrılan sarımsı toz kuyruğu. İki kuyruk da Güneş’in tersi yönünü gösterir.',
        en: 'Comets are small bodies of ice and dust. Near the Sun their ice turns to gas and two tails form: a straight, bluish gas tail pushed by the solar wind and a curved, yellowish dust tail along the orbit. Both point away from the Sun.',
      },
    ],
    date: { year: -43, month: 7, day: 23, hour: 12 },
    startRate: 60,
    staging: [{
      where: 'surface',
      focusId: 'comet44bc',
      autoSeat: true,
      endRate: 60,
      stages: [
        {
          id: 'c44_before', kind: 'before', label: BEFORE, seconds: 6,
          from: { date: { year: -43, month: 7, day: 21, hour: 12 } },
          to: { date: { year: -43, month: 7, day: 21, hour: 18 } },
          caption: {
            tr: '21 Temmuz M.Ö. 44: kuyruklu yıldız sönük, çıplak gözle zor seçiliyor.',
            en: '21 July 44 BC: the comet is faint, barely visible to the naked eye.',
          },
        },
        {
          id: 'c44_outburst', kind: 'event', label: DURING, seconds: 16,
          from: { date: { year: -43, month: 7, day: 21, hour: 18 } },
          to: { date: { year: -43, month: 7, day: 24, hour: 12 } },
          caption: {
            tr: 'Ani parlama (2,5 gün, hızlandırılmış): kuyruklu yıldız birkaç gün içinde binlerce kat parlaklaşıyor. Roma’daki oyunlar sırasında görülen buydu. (Parlama bir modeldir.)',
            en: 'Outburst (2.5 days, sped up): within days the comet becomes thousands of times brighter. This is what was seen in Rome during the games. (The outburst is a model.)',
          },
        },
        {
          id: 'c44_after', kind: 'after', label: AFTER, seconds: 8,
          from: { date: { year: -43, month: 7, day: 24, hour: 12 } },
          to: { date: { year: -43, month: 7, day: 25, hour: 12 } },
          caption: {
            tr: 'En parlak hâlinden sonra hızla sönüyor. Kuyruğun hep Güneş’in tersini gösterdiğine dikkat edin.',
            en: 'After its peak it fades quickly. Notice that the tail always points away from the Sun.',
          },
        },
      ],
    }],
    defaultSiteId: 'apollo15',
    seenFrom: 'earthMoon',
    recommendedSiteIds: ['apollo15', 'copernicus', 'apollo11', 'tycho'],
    primaryTargetId: 'comet44bc',
    notes: [
      {
        tr: 'Yaklaşık: Antik gözlemler az olduğu için kuyruklu yıldızın yörüngesi (NASA/JPL Küçük Cisimler Veritabanı; Ramsey ve Licht, 1997) belirsizdir.',
        en: 'Approximate: ancient observations are few, so the comet’s orbit (NASA/JPL Small-Body Database; Ramsey and Licht, 1997) is uncertain.',
      },
      {
        tr: 'Model: Temmuz sonundaki ani parlaklık artışı, tarihçilerin önerdiği bir parlama modeliyle gösterilir.',
        en: 'Model: the sudden brightening in late July is shown with an outburst model proposed by historians.',
      },
    ],
    infoTopicIds: ['comet', 'halley'],
    accent: '#7ae582',
    cardTopicId: 'comet',
  },

  {
    id: 'conj7bc',
    order: 5,
    category: 'conjunction',
    title: { tr: 'M.Ö. 7: Jüpiter ile Satürn’ün Buluşması', en: '7 BC: Jupiter and Saturn Meet' },
    dateLabel: { tr: '29 Mayıs M.Ö. 7 · Jülyen takvimi', en: '29 May 7 BC · Julian calendar' },
    summary: {
      tr: 'Jüpiter ile Satürn aylar içinde birbirine yaklaşıp Balık takımyıldızında 1 derece arayla yan yana geldi. Bu yaklaşmayı Ay’dan izleyin.',
      en: 'Over several months Jupiter and Saturn drew together until they stood 1 degree apart in Pisces. Watch them close in from the Moon.',
    },
    about: [
      {
        tr: 'Jüpiter ile Satürn yaklaşık her 20 yılda bir gökyüzünde yan yana gelir; buna büyük kavuşum denir. M.Ö. 7 yılında Dünya’nın kendi hareketi yüzünden bu buluşma bir yıl içinde üç kez yaşandı: Mayıs, Eylül ve Aralık aylarında. Bu tür üçlü kavuşumlar seyrektir.',
        en: 'Jupiter and Saturn appear side by side roughly every 20 years; this is called a great conjunction. In 7 BC, because of Earth’s own motion, they met three times in one year: in May, September and December. Such triple conjunctions are rare.',
      },
      {
        tr: 'Gezegenler aslında birbirine yaklaşmaz; aralarında yüz milyonlarca kilometre vardır. Yalnızca bizim baktığımız yerden aynı doğrultuda görünürler.',
        en: 'The planets never actually come close to each other; hundreds of millions of kilometres separate them. They only line up as seen from where we stand.',
      },
    ],
    date: { year: -6, month: 5, day: 29, hour: 6 },
    startRate: 3600,
    staging: [{
      where: 'surface',
      focusId: 'jupiter',
      autoSeat: true,
      endRate: 3600,
      stages: [
        {
          id: 'c7_m4', kind: 'before', label: BEFORE, seconds: 3, zoomFovDeg: 26, shadeSun: true,
          from: { date: { year: -6, month: 5, day: 29, hour: 6 }, offsetDays: -4 * SIDEREAL_MONTH_DAYS },
          caption: {
            tr: 'Şubat M.Ö. 7: Jüpiter ile Satürn arasında 11 derece var. (Görüntüler 27,3 gün arayla seçildi; böylece yıldızlar yerinde kalır, yalnızca gezegenler hareket eder.)',
            en: 'February 7 BC: Jupiter and Saturn are 11 degrees apart. (The frames are 27.3 days apart, so the stars stay in place and only the planets move.)',
          },
        },
        {
          id: 'c7_m3', kind: 'before', label: BEFORE, seconds: 2.5, cut: true, zoomFovDeg: 26, shadeSun: true,
          from: { date: { year: -6, month: 5, day: 29, hour: 6 }, offsetDays: -3 * SIDEREAL_MONTH_DAYS },
          caption: { tr: 'Mart: 8 derece.', en: 'March: 8 degrees.' },
        },
        {
          id: 'c7_m2', kind: 'before', label: BEFORE, seconds: 2.5, cut: true, zoomFovDeg: 26, shadeSun: true,
          from: { date: { year: -6, month: 5, day: 29, hour: 6 }, offsetDays: -2 * SIDEREAL_MONTH_DAYS },
          caption: { tr: 'Nisan: 5 derece.', en: 'April: 5 degrees.' },
        },
        {
          id: 'c7_m1', kind: 'before', label: BEFORE, seconds: 2.5, cut: true, zoomFovDeg: 26, shadeSun: true,
          from: { date: { year: -6, month: 5, day: 29, hour: 6 }, offsetDays: -1 * SIDEREAL_MONTH_DAYS },
          caption: { tr: 'Mayıs başı: 2,5 derece.', en: 'Early May: 2.5 degrees.' },
        },
        {
          id: 'c7_event', kind: 'event', label: DURING, seconds: 9, cut: true, zoomFovDeg: 26, shadeSun: true,
          from: { date: { year: -6, month: 5, day: 29, hour: 6 } },
          caption: {
            tr: '29 Mayıs M.Ö. 7: aralarında yalnızca 1 derece var; bu, yan yana iki dolunay genişliği kadardır. Eylül ve Aralık’ta yeniden buluşacaklar.',
            en: '29 May 7 BC: only 1 degree apart, about the width of two full Moons side by side. They will meet again in September and December.',
          },
        },
      ],
    }],
    defaultSiteId: 'apollo11',
    seenFrom: 'earthMoon',
    recommendedSiteIds: ['apollo11', 'tycho', 'copernicus', 'shackleton'],
    primaryTargetId: 'jupiter',
    notes: [
      {
        tr: 'Gerçek: 29 Mayıs M.Ö. 7 için hesaplanan Jüpiter–Satürn aralığı 1,02 derece; NASA JPL Horizons’ın değeri 0,99 derece.',
        en: 'Real: the computed Jupiter–Saturn separation for 29 May 7 BC is 1.02 degrees; NASA JPL Horizons gives 0.99 degrees.',
      },
    ],
    infoTopicIds: ['conjunction', 'saturn', 'jupiter'],
    accent: '#c792ea',
    cardTopicId: 'conjunction',
  },

  {
    id: 'align2000',
    order: 6,
    category: 'conjunction',
    title: { tr: '5 Mayıs 2000: Güneş’in Yanında Beş Gezegen', en: '5 May 2000: Five Planets Beside the Sun' },
    dateLabel: { tr: '5 Mayıs 2000 · 08:00 UT', en: '5 May 2000 · 08:00 UT' },
    summary: {
      tr: 'Merkür, Venüs, Mars, Jüpiter ve Satürn, Güneş’in hemen yanında toplandı. Dünya’dan gün ışığında görülemeyen bu dizilimi, gökyüzünün gündüz de karanlık olduğu Ay’dan izleyin.',
      en: 'Mercury, Venus, Mars, Jupiter and Saturn gathered right beside the Sun. Lost in daylight on Earth, the line-up can be seen from the Moon, where the sky is dark even by day.',
    },
    about: [
      {
        tr: '5 Mayıs 2000’de Dünya’dan bakıldığında Güneş, Ay ve çıplak gözle görülebilen beş gezegen gökyüzünde yaklaşık 26 derecelik dar bir bölgede toplandı. Gezegenlerin hepsi Güneş’e 16 dereceden daha yakın olduğu için Dünya’dan kimse bu dizilimi göremedi: gündüz gökyüzü çok aydınlıktı.',
        en: 'On 5 May 2000, as seen from Earth, the Sun, the Moon and the five planets visible to the naked eye gathered in a narrow band about 26 degrees wide. Every planet was within 16 degrees of the Sun, so nobody on Earth could see the line-up: the daytime sky was too bright.',
      },
      {
        tr: 'Gündüz gökyüzünün mavi ve aydınlık olmasının nedeni, atmosferin Güneş ışığını her yöne saçmasıdır. Ay’da atmosfer yoktur. Güneş’i elinizle (F) kapattığınızda gezegenler Güneş’in hemen yanında görünür.',
        en: 'The daytime sky is blue and bright because the atmosphere scatters sunlight in every direction. The Moon has no atmosphere. Cover the Sun with your hand (F) and the planets appear right beside it.',
      },
    ],
    date: { year: 2000, month: 5, day: 5, hour: 8 },
    startRate: 1,
    staging: [{
      where: 'surface',
      focusId: 'jupiter',
      autoSeat: true,
      endRate: 1,
      stages: [
        {
          id: 'al_m3', kind: 'before', label: BEFORE, seconds: 3, shadeSun: true,
          from: { date: { year: 2000, month: 5, day: 5, hour: 8 }, offsetDays: -3 * SIDEREAL_MONTH_DAYS },
          caption: {
            tr: 'Şubat 2000: beş gezegen gökyüzünde 107 derecelik bir alana yayılmış. (Görüntüler 27,3 gün arayla seçildi.)',
            en: 'February 2000: the five planets are spread over 107 degrees of sky. (The frames are 27.3 days apart.)',
          },
        },
        {
          id: 'al_m2', kind: 'before', label: BEFORE, seconds: 2.5, cut: true, shadeSun: true,
          from: { date: { year: 2000, month: 5, day: 5, hour: 8 }, offsetDays: -2 * SIDEREAL_MONTH_DAYS },
          caption: { tr: 'Mart: 76 derece.', en: 'March: 76 degrees.' },
        },
        {
          id: 'al_m1', kind: 'before', label: BEFORE, seconds: 2.5, cut: true, shadeSun: true,
          from: { date: { year: 2000, month: 5, day: 5, hour: 8 }, offsetDays: -1 * SIDEREAL_MONTH_DAYS },
          caption: { tr: 'Nisan: 54 derece.', en: 'April: 54 degrees.' },
        },
        {
          id: 'al_event', kind: 'event', label: DURING, seconds: 9, cut: true, shadeSun: true,
          from: { date: { year: 2000, month: 5, day: 5, hour: 8 } },
          caption: {
            tr: '5 Mayıs 2000: beşi de 26 derecelik bir alanda, Güneş’in hemen yanında. Dünya’dan gün ışığı yüzünden görülemediler; Ay’da el Güneş’i kapatınca görünüyorlar.',
            en: '5 May 2000: all five within 26 degrees, right beside the Sun. Daylight hid them from Earth; on the Moon they show up once a hand covers the Sun.',
          },
        },
      ],
    }],
    defaultSiteId: 'apollo11',
    seenFrom: 'earthMoon',
    recommendedSiteIds: ['apollo11', 'mare_crisium', 'apollo17', 'shackleton'],
    primaryTargetId: 'mars',
    marsFocusAssetIds: ['mgs', 'pathfinder', 'viking1', 'viking2'],
    notes: [
      {
        tr: 'Gerçek: Gezegenlerin konumları NASA JPL Horizons ile 6 yay saniyesinden daha az farkla örtüşür (dolunayın genişliğinin yaklaşık üç yüzde biri).',
        en: 'Real: the planet positions match NASA JPL Horizons to better than 6 arcseconds (about one three-hundredth of the full Moon’s width).',
      },
    ],
    infoTopicIds: ['planets', 'mgs', 'pathfinder', 'mars_global'],
    accent: '#4dd0e1',
    cardTopicId: 'planets',
  },

  {
    id: 'mars2003',
    order: 7,
    category: 'mars',
    title: { tr: '2003: Mars’ın 60.000 Yıldaki En Yakın Geçişi', en: '2003: Mars at Its Closest in 60,000 Years' },
    dateLabel: { tr: '27 Ağustos 2003 · 09:51 UT', en: '27 August 2003 · 09:51 UT' },
    summary: {
      tr: 'Ağustos 2003’te Mars, Dünya’ya yaklaşık 60.000 yıldır olmadığı kadar yaklaştı. Teleskopta Mars’ın aylar içinde nasıl büyüdüğünü izleyin.',
      en: 'In August 2003 Mars came closer to Earth than at any time in about 60,000 years. Watch it grow in the telescope over the months.',
    },
    about: [
      {
        tr: '27 Ağustos 2003’te Mars ile Dünya arasındaki uzaklık 55,76 milyon kilometreye indi; ışık bu yolu yalnızca 3 dakika 6 saniyede alıyordu. Mars’ın bu kadar yaklaşması için iki şeyin aynı anda olması gerekir: Dünya’nın Güneş ile Mars’ın arasına girmesi (karşı konum) ve Mars’ın yörüngesinde Güneş’e en yakın bölgede bulunması.',
        en: 'On 27 August 2003 the distance between Mars and Earth fell to 55.76 million kilometres; light crossed it in just 3 minutes 6 seconds. For Mars to come this close, two things must happen together: Earth passes between the Sun and Mars (opposition), and Mars is near the part of its orbit closest to the Sun.',
      },
      {
        tr: 'Gökteki boyutlar açıyla ölçülür. Yay saniyesi (″) çok küçük bir açıdır: dolunay yaklaşık 1.800″ genişliğindedir. En yakın anında bile Mars teleskopta yalnızca 25″ görünür.',
        en: 'Sizes in the sky are measured as angles. An arcsecond (″) is a very small angle: the full Moon is about 1,800″ across. Even at its closest, Mars spans only 25″ in a telescope.',
      },
      {
        tr: 'Bu sırada NASA’nın ikiz gezginleri Spirit ve Opportunity Mars’a doğru yoldaydı; Ocak 2004’te indiler. Yakın görünümde, o tarihte Mars’ta bulunan araçları görebilirsiniz.',
        en: 'At the time NASA’s twin rovers Spirit and Opportunity were on their way to Mars; they landed in January 2004. In the close-up view you can see the spacecraft that were on Mars at that date.',
      },
    ],
    date: { year: 2003, month: 8, day: 27, hour: 9, minute: 51 },
    startRate: 1,
    staging: [{
      where: 'surface',
      focusId: 'mars',
      autoSeat: true,
      endRate: 1,
      stages: [
        {
          id: 'm03_m3', kind: 'before', label: BEFORE, seconds: 3, telescopeFovDeg: 0.06,
          from: { date: { year: 2003, month: 8, day: 27, hour: 9, minute: 51 }, offsetDays: -3 * SIDEREAL_MONTH_DAYS },
          caption: {
            tr: 'Haziran 2003, teleskopta Mars: 108 milyon km uzakta, 13″ genişliğinde. (Görüntüler 27,3 gün arayla seçildi.)',
            en: 'June 2003, Mars in the telescope: 108 million km away and 13″ across. (The frames are 27.3 days apart.)',
          },
        },
        {
          id: 'm03_m2', kind: 'before', label: BEFORE, seconds: 2.5, cut: true, telescopeFovDeg: 0.06,
          from: { date: { year: 2003, month: 8, day: 27, hour: 9, minute: 51 }, offsetDays: -2 * SIDEREAL_MONTH_DAYS },
          caption: { tr: 'Temmuz başı: 82 milyon km, 17″.', en: 'Early July: 82 million km, 17″.' },
        },
        {
          id: 'm03_m1', kind: 'before', label: BEFORE, seconds: 2.5, cut: true, telescopeFovDeg: 0.06,
          from: { date: { year: 2003, month: 8, day: 27, hour: 9, minute: 51 }, offsetDays: -1 * SIDEREAL_MONTH_DAYS },
          caption: { tr: 'Temmuz sonu: 63 milyon km, 22″.', en: 'Late July: 63 million km, 22″.' },
        },
        {
          id: 'm03_event', kind: 'event', label: DURING, seconds: 9, cut: true, telescopeFovDeg: 0.06,
          from: { date: { year: 2003, month: 8, day: 27, hour: 9, minute: 51 } },
          caption: {
            tr: '27 Ağustos 2003: 56 milyon km, 25″. Mars yaklaşık 60.000 yılın en yakın noktasında ve gökyüzündeki en parlak cisimlerden biri.',
            en: '27 August 2003: 56 million km, 25″. Mars is at its closest in about 60,000 years and one of the brightest objects in the sky.',
          },
        },
      ],
    }],
    defaultSiteId: 'tycho',
    seenFrom: 'earthMoon',
    recommendedSiteIds: ['tycho', 'apollo11', 'copernicus', 'shackleton'],
    primaryTargetId: 'mars',
    marsFocusAssetIds: ['viking1', 'viking2', 'pathfinder', 'mgs'],
    notes: [
      {
        tr: 'Gerçek: Uzaklık, görünür büyüklük ve parlaklık o tarihler için hesaplanan değerlerdir.',
        en: 'Real: the distances, apparent sizes and brightness are computed for those dates.',
      },
      {
        tr: 'Büyütme: Yakın görünümdeki Mars küresi NASA haritalarından yapılmıştır; gerçek bir teleskopta Mars bu kadar ayrıntılı görünmez.',
        en: 'Magnified: the Mars globe in the close-up view is built from NASA maps; a real telescope does not show Mars in this much detail.',
      },
    ],
    infoTopicIds: ['mars_2003', 'viking', 'mars_global'],
    accent: '#ff6b6b',
    cardTopicId: 'mars_2003',
  },

  {
    id: 'dust2018',
    order: 8,
    category: 'mars',
    title: { tr: '2018 Mars Toz Fırtınası', en: 'The 2018 Martian Dust Storm' },
    dateLabel: { tr: '20 Haziran 2018 · 00:00 UT', en: '20 June 2018 · 00:00 UT' },
    summary: {
      tr: 'Mayıs 2018’in sonunda başlayan toz fırtınası birkaç haftada bütün Mars’ı sardı. Güneş enerjisiyle çalışan Opportunity gezgini bu fırtınada sustu.',
      en: 'A dust storm that began in late May 2018 wrapped all of Mars within weeks. The solar-powered Opportunity rover fell silent in it.',
    },
    about: [
      {
        tr: 'Mars’ta toz fırtınaları sık görülür; birkaç yılda bir de bütün gezegeni saran dev fırtınalar oluşur. 2018’deki fırtına Mayıs sonunda bölgesel olarak başladı ve Haziran ortasında gezegenin tamamını kapladı. Toz o kadar yoğundu ki yüzeye ulaşan Güneş ışığı neredeyse tamamen kesildi.',
        en: 'Dust storms are common on Mars, and every few years one grows to cover the whole planet. The 2018 storm started as a regional storm in late May and covered the entire planet by mid-June. The dust was so thick that almost no sunlight reached the ground.',
      },
      {
        tr: 'Opportunity gezgini yalnızca 90 Mars günü çalışmak için tasarlanmıştı, ama 14 yıldan uzun süre çalıştı ve 45 kilometre yol aldı. Güneş panelleriyle çalıştığı için fırtınada enerjisi tükendi ve 10 Haziran 2018’de son kez sinyal gönderdi. Nükleer güç kaynağıyla çalışan Curiosity gezgini ise fırtına boyunca çalışmayı sürdürdü.',
        en: 'Opportunity was designed to work for 90 Martian days but kept going for more than 14 years and drove 45 kilometres. Because it ran on solar panels, it ran out of power in the storm and sent its last signal on 10 June 2018. Curiosity, powered by a nuclear generator, kept working throughout.',
      },
      {
        tr: 'Bu olay Mars’ın yakın görünümünde oynar. Küre üzerindeki işaretlere ya da listedeki araçlara tıklayarak bilgi kartlarını açabilirsiniz.',
        en: 'This event plays in the Mars close-up view. Click the markers on the globe or the spacecraft in the list to open their information cards.',
      },
    ],
    date: { year: 2018, month: 6, day: 20, hour: 0 },
    startRate: 1,
    staging: [{
      where: 'mars',
      endRate: 1,
      stages: [
        {
          id: 'd18_before', kind: 'before', label: BEFORE, seconds: 5,
          from: { date: { year: 2018, month: 5, day: 24 } },
          to: { date: { year: 2018, month: 5, day: 29 } },
          caption: {
            tr: 'Mayıs 2018: Mars’ta gökyüzü açık. Güneş enerjisiyle çalışan Opportunity, Mars’taki 15. yılında.',
            en: 'May 2018: clear skies on Mars. The solar-powered Opportunity is in its fifteenth year on Mars.',
          },
        },
        {
          id: 'd18_storm', kind: 'event', label: DURING, seconds: 14,
          from: { date: { year: 2018, month: 5, day: 29 } },
          to: { date: { year: 2018, month: 6, day: 20 } },
          caption: {
            tr: '30 Mayıs’tan itibaren (hızlandırılmış): kuzeyde Acidalia bölgesi yakınında başlayan fırtına üç haftada bütün gezegeni sarıyor. (Fırtınanın yayılışı bir canlandırmadır.)',
            en: 'From 30 May (sped up): a storm that began in the north, near Acidalia, wraps the whole planet in three weeks. (The spread of the storm is an illustration.)',
          },
        },
        {
          id: 'd18_after', kind: 'after', label: AFTER, seconds: 6,
          from: { date: { year: 2018, month: 6, day: 20 } },
          to: { date: { year: 2018, month: 7, day: 10 } },
          caption: {
            tr: '20 Haziran – 10 Temmuz: gezegen tozla kaplı kalıyor. Opportunity 10 Haziran’dan beri sessiz; nükleer güçle çalışan Curiosity çalışmayı sürdürüyor.',
            en: '20 June – 10 July: the planet stays covered in dust. Opportunity has been silent since 10 June; nuclear-powered Curiosity carries on.',
          },
        },
      ],
    }],
    defaultSiteId: 'apollo17',
    seenFrom: 'anywhere',
    recommendedSiteIds: ['apollo17', 'apollo11', 'tycho', 'shackleton'],
    primaryTargetId: 'mars',
    marsFocusAssetIds: ['opportunity', 'curiosity', 'spirit', 'perseverance', 'ingenuity'],
    notes: [
      {
        tr: 'Gerçek: Tarihler ve araçların konumları NASA kayıtlarındandır. Mars yüzeyi, Viking yörünge araçlarının fotoğraflarından yapılmış bir haritadır.',
        en: 'Real: the dates and the positions of the spacecraft come from NASA records. The Martian surface is a map made from Viking orbiter photographs.',
      },
      {
        tr: 'Model: Fırtınanın yayılışı, NASA’nın Mars Keşif Yörünge Aracı (MRO) gözlemlerindeki tarihlere göre çizilmiş basitleştirilmiş bir canlandırmadır.',
        en: 'Model: the spread of the storm is a simplified illustration timed to observations by NASA’s Mars Reconnaissance Orbiter (MRO).',
      },
    ],
    infoTopicIds: ['mars_dust_2018', 'opportunity', 'curiosity', 'perseverance', 'ingenuity'],
    accent: '#f4a261',
    cardTopicId: 'mars_dust_2018',
  },

  {
    id: 'storm2024',
    order: 9,
    category: 'solar',
    title: { tr: 'Mayıs 2024 Güneş Fırtınası', en: 'The May 2024 Solar Storm' },
    dateLabel: { tr: '10 Mayıs 2024 · 17:00 UT', en: '10 May 2024 · 17:00 UT' },
    summary: {
      tr: 'Güneş’ten art arda fırlayan dev madde bulutları Dünya’ya ulaştı ve 2003’ten beri en güçlü jeomanyetik fırtınayı başlattı. Kutup ışıkları alışılmadık derecede güneyde görüldü.',
      en: 'Huge clouds of material thrown off by the Sun one after another reached Earth and set off the strongest geomagnetic storm since 2003. Auroras were seen unusually far south.',
    },
    about: [
      {
        tr: '8–9 Mayıs 2024’te Güneş’in Dünya’ya bakan yüzündeki büyük leke grubu AR 3664 art arda güçlü patlamalar ve koronal kütle atımları (CME) üretti. Koronal kütle atımı, Güneş’ten uzaya saatte milyonlarca kilometre hızla fırlatılan dev bir gaz ve manyetik alan bulutudur.',
        en: 'On 8–9 May 2024 the large sunspot group AR 3664, on the side of the Sun facing Earth, produced a series of powerful flares and coronal mass ejections (CMEs). A CME is a huge cloud of gas and magnetic field thrown into space at millions of kilometres per hour.',
      },
      {
        tr: 'Bu bulutlar 10 Mayıs’ta Dünya’ya ulaştı ve en üst seviye olan G5 sınıfında bir jeomanyetik fırtına başlattı; bu seviyede son fırtına 2003’te yaşanmıştı. Dünya’yı manyetik alanı ve atmosferi korur. Ay’da ikisi de yoktur; bu yüzden güneş fırtınaları Ay’da çalışacak astronotlar için önemli bir radyasyon tehlikesidir.',
        en: 'The clouds reached Earth on 10 May and set off a geomagnetic storm of the highest level, G5; the last storm this strong was in 2003. Earth is shielded by its magnetic field and atmosphere. The Moon has neither, so solar storms are a serious radiation hazard for astronauts working there.',
      },
      {
        tr: 'Bu olay Güneş’in yakın görünümünde oynar: koronal kütle atımlarının Güneş’ten ayrılıp Dünya’ya ulaşmasını yukarıdan izlersiniz. Gezegenlerin boyutları ölçekli değildir.',
        en: 'This event plays in the Sun close-up view: you watch the CMEs leave the Sun and reach Earth from above. The sizes of the planets are not to scale.',
      },
    ],
    date: { year: 2024, month: 5, day: 10, hour: 17 },
    startRate: 3600,
    staging: [{
      where: 'sun',
      endRate: 3600,
      stages: [
        {
          id: 's24_before', kind: 'before', label: BEFORE, seconds: 5,
          from: { date: { year: 2024, month: 5, day: 7 } },
          to: { date: { year: 2024, month: 5, day: 8, hour: 4 } },
          caption: {
            tr: '7 Mayıs 2024: Dünya’ya bakan yüzdeki büyük leke grubu AR 3664 büyüyor. Henüz Dünya’ya doğru bir püskürme yok.',
            en: '7 May 2024: the large sunspot group AR 3664 is growing on the side facing Earth. Nothing has erupted toward Earth yet.',
          },
        },
        {
          id: 's24_cmes', kind: 'event', label: DURING, seconds: 18,
          from: { date: { year: 2024, month: 5, day: 8, hour: 4 } },
          to: { date: { year: 2024, month: 5, day: 10, hour: 18 } },
          caption: {
            tr: '8–10 Mayıs (hızlandırılmış): Dünya’ya yönelen koronal kütle atımları art arda Güneş’ten ayrılıyor. Zamanları, hızları ve yönleri NASA DONKI kayıtlarından.',
            en: '8–10 May (sped up): CMEs aimed at Earth leave the Sun one after another. Their times, speeds and directions come from NASA DONKI records.',
          },
        },
        {
          id: 's24_arrival', kind: 'after', label: AFTER, seconds: 7,
          from: { date: { year: 2024, month: 5, day: 10, hour: 18 } },
          to: { date: { year: 2024, month: 5, day: 11, hour: 18 } },
          caption: {
            tr: '10 Mayıs akşamı: şok cepheleri Dünya’ya ulaştı. G5 sınıfı jeomanyetik fırtına başladı; kutup ışıkları alışılmadık derecede güneyde görüldü.',
            en: 'Evening of 10 May: the shock fronts have reached Earth. A G5 geomagnetic storm has begun; auroras were seen unusually far south.',
          },
        },
      ],
    }],
    defaultSiteId: 'shackleton',
    seenFrom: 'anywhere',
    recommendedSiteIds: ['shackleton', 'connecting_ridge', 'apollo11', 'malapert'],
    primaryTargetId: 'sun',
    notes: [
      {
        tr: 'Gerçek: Koronal kütle atımlarının çıkış zamanları, hızları ve yönleri NASA’nın uzay havası veritabanı DONKI’den alınmıştır.',
        en: 'Real: the start times, speeds and directions of the CMEs come from DONKI, NASA’s space weather database.',
      },
      {
        tr: 'Model: Şok cephelerinin sabit hızla ilerlediği varsayılmıştır; gerçekte güneş rüzgârının etkisiyle yavaşlarlar.',
        en: 'Model: the shock fronts are assumed to travel at constant speed; in reality the solar wind slows them down.',
      },
    ],
    infoTopicIds: ['solar_storm', 'artemis'],
    accent: '#ffbe0b',
    cardTopicId: 'solar_storm',
  },

  {
    id: 'eclipse2026',
    order: 10,
    category: 'eclipse',
    title: { tr: '12 Ağustos 2026 Güneş Tutulması: Ay’dan Bakış', en: 'The Solar Eclipse of 12 August 2026, Seen from the Moon' },
    dateLabel: { tr: '12 Ağustos 2026 · 17:46 UT', en: '12 August 2026 · 17:46 UT' },
    summary: {
      tr: 'Grönland, İzlanda ve İspanya’da tam Güneş tutulması yaşanırken Ay’ın gölgesinin Dünya üzerinde ilerleyişini Ay’dan izleyin.',
      en: 'While Greenland, Iceland and Spain see a total solar eclipse, watch the Moon’s shadow move across Earth from the Moon itself.',
    },
    about: [
      {
        tr: 'Güneş tutulmasında Ay, Güneş ile Dünya’nın arasına girer ve gölgesi Dünya’ya düşer. 12 Ağustos 2026’da Ay’ın tam gölgesi, yani tam tutulmanın görüldüğü dar şerit, Grönland, İzlanda ve İspanya üzerinden geçer. En büyük tutulma 17:46 UT’de.',
        en: 'In a solar eclipse the Moon passes between the Sun and Earth and its shadow falls on Earth. On 12 August 2026 the Moon’s full shadow, the narrow strip where the eclipse is total, crosses Greenland, Iceland and Spain. Greatest eclipse is at 17:46 UT.',
      },
      {
        tr: 'Tutulma sırasında Ay’ın Dünya’ya bakan yüzünde gecedir, çünkü Güneş Ay’ın arkasında kalır. Bu yüzden Ay’dan bakan biri tamamen aydınlık bir Dünya ve üzerinde ilerleyen koyu bir gölge görür.',
        en: 'During the eclipse it is night on the side of the Moon facing Earth, because the Sun is behind the Moon. Someone standing on the Moon therefore sees a fully lit Earth with a dark shadow moving across it.',
      },
    ],
    date: { year: 2026, month: 8, day: 12, hour: 17, minute: 46 },
    startRate: 60,
    staging: [{
      where: 'surface',
      focusId: 'earth',
      endRate: 60,
      stages: [
        {
          id: 'e26_before', kind: 'before', label: BEFORE, seconds: 5, telescopeFovDeg: 3,
          from: { date: { year: 2026, month: 8, day: 12, hour: 16, minute: 20 } },
          to: { date: { year: 2026, month: 8, day: 12, hour: 16, minute: 55 } },
          caption: {
            tr: '12 Ağustos 2026, teleskopta Dünya. Ay’ın gölgesi henüz Dünya’ya değmedi. Gölgeyi düşüren gök cismi, şu an üzerinde durduğunuz Ay’dır.',
            en: '12 August 2026, Earth in the telescope. The Moon’s shadow has not reached Earth yet. The body casting it is the Moon you are standing on.',
          },
        },
        {
          id: 'e26_shadow', kind: 'event', label: DURING, seconds: 18, telescopeFovDeg: 3,
          from: { date: { year: 2026, month: 8, day: 12, hour: 16, minute: 55 } },
          to: { date: { year: 2026, month: 8, day: 12, hour: 18, minute: 50 } },
          caption: {
            tr: 'Hızlandırılmış: Ay’ın gölgesi Grönland, İzlanda ve İspanya üzerinden geçiyor. En büyük tutulma 17:46 UT’de.',
            en: 'Sped up: the Moon’s shadow crosses Greenland, Iceland and Spain. Greatest eclipse is at 17:46 UT.',
          },
        },
        {
          id: 'e26_after', kind: 'after', label: AFTER, seconds: 5,
          from: { date: { year: 2026, month: 8, day: 12, hour: 18, minute: 50 } },
          caption: {
            tr: 'Gölge Dünya’dan ayrıldı. Bir sonraki tam Güneş tutulması 2 Ağustos 2027’de, İspanya’dan Mısır’a uzanan bir şeritte görülecek.',
            en: 'The shadow has left Earth. The next total solar eclipse, on 2 August 2027, will be seen along a strip from Spain to Egypt.',
          },
        },
      ],
    }],
    defaultSiteId: 'apollo11',
    seenFrom: 'moon',
    recommendedSiteIds: ['apollo11', 'tycho', 'copernicus', 'shackleton'],
    primaryTargetId: 'earth',
    notes: [
      {
        tr: 'Gerçek: Gölge, Güneş’in ve Ay’ın o anki konumlarından Dünya’nın her noktası için ayrı ayrı hesaplanır; elle çizilmiş bir resim değildir.',
        en: 'Real: the shadow is computed for every point on Earth from the positions of the Sun and Moon at that moment; it is not a painted picture.',
      },
      {
        tr: 'Gerçek: Dünya’nın bu tarihteki görüntüsü, NASA uydularının 12 Ağustos 2026’da çektiği bulutlu fotoğraflardan yapılmıştır.',
        en: 'Real: the picture of Earth on this date is made from cloud-covered images taken by NASA satellites on 12 August 2026.',
      },
    ],
    infoTopicIds: ['eclipse_2026', 'earth_from_moon'],
    accent: '#38bdf8',
    cardTopicId: 'eclipse_2026',
  },

  {
    id: 'shackleton2030',
    order: 11,
    category: 'future',
    title: { tr: 'Ay’ın Güney Kutbunda Gün Doğumu', en: 'Sunrise at the Moon’s South Pole' },
    dateLabel: { tr: '19 Ocak 2030 · gün doğumu', en: '19 January 2030 · sunrise' },
    summary: {
      tr: 'Güneş’in hiç yükselmediği, ufkun hemen üzerinde dolaştığı güney kutbunda gün doğumunu izleyin: tepeler aydınlanırken krater içi karanlıkta kalır.',
      en: 'Watch sunrise at the south pole, where the Sun never climbs high but circles just above the horizon: the ridges light up while the crater floor stays dark.',
    },
    about: [
      {
        tr: 'Ay’ın dönme ekseni yalnızca 1,5 derece eğik olduğu için kutuplarda Güneş hiçbir zaman yükselmez; ufkun hemen üzerinde ya da altında dolaşır. Bu yüzden yüksek tepeler yılın büyük bölümünde aydınlık kalırken derin kraterlerin tabanı hiç Güneş görmez.',
        en: 'Because the Moon’s axis is tilted by only 1.5 degrees, the Sun never rises high at the poles; it circles just above or below the horizon. High ridges stay lit for much of the year, while the floors of deep craters never see the Sun.',
      },
      {
        tr: 'Sürekli gölgedeki bu çok soğuk kraterlerde su buzu bulunduğu düşünülüyor. Aydınlık tepeler ise güneş enerjisi için uygun. Bu nedenle NASA’nın Artemis programı insanlı inişler için güney kutbu bölgesini hedefliyor.',
        en: 'These permanently shadowed, very cold craters are thought to hold water ice, and the sunlit ridges are good places for solar power. That is why NASA’s Artemis programme is aiming crewed landings at the south polar region.',
      },
      {
        tr: 'Buradaki arazi, LRO uydusunun lazer ölçümleriyle 5 metre çözünürlükte haritalanmış gerçek arazidir. B tuşuyla bulunduğunuz yere bir ölçüm direği koyarsanız, önümüzdeki 29,5 gün boyunca orada Güneş’in ve Dünya’nın ne kadar süre görüneceği hesaplanır.',
        en: 'The ground here is real terrain, mapped at 5-metre resolution by the LRO spacecraft’s laser. Press B to place a measuring mast where you stand: it works out how much of the next 29.5 days the Sun and Earth will be visible from there.',
      },
    ],
    date: { year: 2030, month: 1, day: 19, hour: 8 },
    startRate: 60,
    staging: [{
      where: 'surface',
      focusId: 'sun',
      endRate: 60,
      stages: [
        {
          id: 's30_before', kind: 'before', label: BEFORE, seconds: 6,
          from: { date: { year: 2030, month: 1, day: 19, hour: 2 } },
          to: { date: { year: 2030, month: 1, day: 19, hour: 7 } },
          caption: {
            tr: '19 Ocak 2030, Shackleton krateri kenarı. Güneş uzaktaki bir sırtın arkasında, ufkun yaklaşık 1 derece altında. Yer yalnızca Dünya’dan yansıyan ışıkla aydınlanıyor.',
            en: '19 January 2030, the rim of Shackleton crater. The Sun is behind a distant ridge, about 1 degree below the horizon. Only light reflected from Earth lights the ground.',
          },
        },
        {
          id: 's30_sunrise', kind: 'event', label: DURING, seconds: 14,
          from: { date: { year: 2030, month: 1, day: 19, hour: 7 } },
          to: { date: { year: 2030, month: 1, day: 19, hour: 10 } },
          caption: {
            tr: 'Gün doğumu (hızlandırılmış): Güneş ufku sıyırarak yükseliyor. Tepeler aydınlanıyor, krater içi gölgede kalıyor.',
            en: 'Sunrise (sped up): the Sun creeps up along the horizon. The ridges light up; the crater floor stays in shadow.',
          },
        },
        {
          id: 's30_after', kind: 'after', label: AFTER, seconds: 6, focusId: 'none',
          from: { date: { year: 2030, month: 1, day: 19, hour: 10 } },
          caption: {
            tr: 'Bu ışık–gölge dengesi, iniş yerleri seçilirken en önemli etkenlerden biri. Hem Güneş’i hem Dünya’yı gören bir yer bulmaya çalışın.',
            en: 'This balance of light and shadow is one of the main factors in choosing landing sites. Try to find a spot that sees both the Sun and Earth.',
          },
        },
      ],
    }],
    defaultSiteId: 'shackleton',
    seenFrom: 'moon',
    recommendedSiteIds: ['shackleton', 'connecting_ridge', 'malapert', 'im1_malapert_a'],
    primaryTargetId: 'sun',
    notes: [
      {
        tr: 'Gerçek: Arazi yükseklikleri NASA’nın LOLA 5 m/piksel güney kutbu verisinden (PGDA, Site04) okunur.',
        en: 'Real: the terrain heights are read from NASA’s 5 m/pixel LOLA south pole data (PGDA, Site04).',
      },
      {
        tr: 'Gerçek: Ölçüm direğinin sonuçları, o noktadaki gerçek arazi ufkuna göre hesaplanır.',
        en: 'Real: the measuring mast’s results are computed against the real terrain horizon at that point.',
      },
    ],
    infoTopicIds: ['shackleton', 'artemis', 'earth_from_moon'],
    accent: '#6ee7a8',
    cardTopicId: 'shackleton',
  },
];
