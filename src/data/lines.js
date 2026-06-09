/**
 * Shenzhen Metro line metadata.
 *
 * Sources: 深圳地铁集团 official site, Wikipedia 深圳地铁线路, and field signage.
 * Colors approximate official PANTONE specs as commonly published.
 * Operating hours: each line's published end-of-day window; gaps outside the
 * window mean no trains are simulated.
 * Headway: average minutes between trains. Peak windows reflect 7:30-9:30 AM
 * and 17:30-19:30 PM published intervals. Off-peak uses the line's typical
 * weekday daytime headway.
 *
 * `query` is the string passed to AMap LineSearch when no station list is
 * cached locally. It must exactly match AMap's 公交线路 record name.
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
        color: '#009A44',
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
        color: '#E84C7C',
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
        color: '#00A2DE',
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
        color: '#DE0011',
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
        color: '#93357C',
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
        color: '#98C843',
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
        color: '#00B5A4',
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
        color: '#00A0E9',
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
        color: '#C0884C',
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
        color: '#E5316C',
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
        color: '#6B2C8B',
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
        color: '#003F8E',
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
        color: '#2D6F5D',
        textColor: '#FFFFFF',
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
        color: '#B58151',
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
        color: '#A4538C',
        textColor: '#FFFFFF',
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
