/**
 * Shenzhen Metro line metadata.
 *
 * Colors are the authoritative hex values from the Wikipedia
 * `Template:深圳地铁颜色` (`Module:Adjacent stations/深圳地铁`), which mirror
 * the Shenzhen municipal standard "Road Traffic Management Facilities
 * Installation Technical Standard Part 5: Transit Hub Passenger Service
 * Signs" — i.e. the official PANTONE specs converted to RGB. Don't tweak
 * these by eye.
 *
 * Note: L2 (蛇口) and L8 (盐田) share `#db6d1c` because the two are
 * operationally a single through-running line in revenue service, and the
 * official map paints them the same colour.
 *
 * Operating hours: each line's published first/last train window; outside
 * that window no trains are simulated.
 * Headway: average minutes between trains, peak vs off-peak.
 *
 * `query` is the string passed to AMap's bus/linename REST endpoint to
 * fetch the polyline and station list.
 */

const PEAK_WINDOWS = [
    {start: '07:30', end: '09:30'},
    {start: '17:30', end: '19:30'}
];

export const SHENZHEN_CENTER = [114.0579, 22.5431]; // 深圳市政府附近
export const DEFAULT_BOUNDS = [113.75, 22.40, 114.65, 22.85];

export const LINES = [
    {
        id: '1',
        code: '1',
        nameZh: '罗宝线',
        nameEn: 'Luobao Line',
        color: '#00ab39',
        textColor: '#FFFFFF',
        query: '深圳地铁1号线',
        firstTrain: '06:30',
        lastTrain: '23:30',
        headway: 3.5,
        peakHeadway: 2.5,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 60
    },
    {
        id: '2',
        code: '2',
        nameZh: '蛇口线',
        nameEn: 'Shekou Line',
        color: '#db6d1c',
        textColor: '#FFFFFF',
        query: '深圳地铁2号线',
        firstTrain: '06:30',
        lastTrain: '23:00',
        headway: 4,
        peakHeadway: 3,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 55
    },
    {
        id: '3',
        code: '3',
        nameZh: '龙岗线',
        nameEn: 'Longgang Line',
        color: '#00a2e1',
        textColor: '#FFFFFF',
        query: '深圳地铁3号线',
        firstTrain: '06:25',
        lastTrain: '23:00',
        headway: 3.5,
        peakHeadway: 2.5,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 60
    },
    {
        id: '4',
        code: '4',
        nameZh: '龙华线',
        nameEn: 'Longhua Line',
        color: '#dc241f',
        textColor: '#FFFFFF',
        query: '深圳地铁4号线',
        firstTrain: '06:30',
        lastTrain: '23:15',
        headway: 4,
        peakHeadway: 2.8,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 60
    },
    {
        id: '5',
        code: '5',
        nameZh: '环中线',
        nameEn: 'Huanzhong Line',
        color: '#9950b2',
        textColor: '#FFFFFF',
        query: '深圳地铁5号线',
        firstTrain: '06:30',
        lastTrain: '23:00',
        headway: 4,
        peakHeadway: 3,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 55
    },
    {
        id: '6',
        code: '6',
        nameZh: '光明线',
        nameEn: 'Guangming Line',
        color: '#3abca8',
        textColor: '#FFFFFF',
        query: '深圳地铁6号线',
        firstTrain: '06:30',
        lastTrain: '23:00',
        headway: 6,
        peakHeadway: 5,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 80
    },
    {
        id: '7',
        code: '7',
        nameZh: '西丽线',
        nameEn: 'Xili Line',
        color: '#0035ad',
        textColor: '#FFFFFF',
        query: '深圳地铁7号线',
        firstTrain: '06:30',
        lastTrain: '23:00',
        headway: 5,
        peakHeadway: 4,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 55
    },
    {
        id: '8',
        code: '8',
        nameZh: '盐田线',
        nameEn: 'Yantian Line',
        color: '#db6d1c',
        textColor: '#FFFFFF',
        query: '深圳地铁8号线',
        firstTrain: '06:30',
        lastTrain: '22:45',
        headway: 8,
        peakHeadway: 6,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 60
    },
    {
        id: '9',
        code: '9',
        nameZh: '梅林线',
        nameEn: 'Meilin Line',
        color: '#846e74',
        textColor: '#FFFFFF',
        query: '深圳地铁9号线',
        firstTrain: '06:30',
        lastTrain: '23:00',
        headway: 5,
        peakHeadway: 3.5,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 55
    },
    {
        id: '10',
        code: '10',
        nameZh: '坂田线',
        nameEn: 'Bantian Line',
        color: '#f8779e',
        textColor: '#FFFFFF',
        query: '深圳地铁10号线',
        firstTrain: '06:30',
        lastTrain: '23:00',
        headway: 5,
        peakHeadway: 3.5,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 60
    },
    {
        id: '11',
        code: '11',
        nameZh: '机场线',
        nameEn: 'Airport Line',
        color: '#6a1d44',
        textColor: '#FFFFFF',
        query: '深圳地铁11号线',
        firstTrain: '06:30',
        lastTrain: '23:00',
        headway: 7,
        peakHeadway: 5,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 90
    },
    {
        id: '12',
        code: '12',
        nameZh: '南宝线',
        nameEn: 'Nanbao Line',
        color: '#a192b2',
        textColor: '#FFFFFF',
        query: '深圳地铁12号线',
        firstTrain: '06:30',
        lastTrain: '23:00',
        headway: 6,
        peakHeadway: 4,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 60
    },
    {
        id: '14',
        code: '14',
        nameZh: '东部快线',
        nameEn: 'Eastern Express',
        color: '#f2c75c',
        textColor: '#000000',
        query: '深圳地铁14号线',
        firstTrain: '06:30',
        lastTrain: '23:00',
        headway: 8,
        peakHeadway: 6,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 100
    },
    {
        id: '16',
        code: '16',
        nameZh: '龙坪线',
        nameEn: 'Longping Line',
        color: '#1e22aa',
        textColor: '#FFFFFF',
        query: '深圳地铁16号线',
        firstTrain: '06:30',
        lastTrain: '23:00',
        headway: 8,
        peakHeadway: 6,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 80
    },
    {
        id: '20',
        code: '20',
        nameZh: '机场快线',
        nameEn: 'Airport Express',
        color: '#88dbdf',
        textColor: '#000000',
        query: '深圳地铁20号线',
        firstTrain: '06:30',
        lastTrain: '22:30',
        headway: 12,
        peakHeadway: 10,
        peakWindows: PEAK_WINDOWS,
        cruiseKmh: 90
    }
];

export function findLine(id) {
    return LINES.find(l => l.id === String(id));
}
