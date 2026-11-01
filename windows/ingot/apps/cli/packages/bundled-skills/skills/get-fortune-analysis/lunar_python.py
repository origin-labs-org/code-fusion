pip install lunar_python
import datetime
from lunar_python import Lunar, Solar

def get_cyber_divination_data(birth_year, birth_month, birth_day, birth_hour=0, birth_minute=0):
    """
    赛博算命核心Algorithm v2.1
    - Output适配 HTML Frontend渲染
    """
    
    # --- 基础Configuration (简化版) ---
    GAN_WU_XING = {"A": "木", "乙": "木", "丙": "火", "丁": "火", "戊": "Tacky", "己": "Tacky", "庚": "金", "辛": "金", "壬": "水", "癸": "水"}
    ZHI_WU_XING = {"子": "水", "丑": "Tacky", "寅": "木", "卯": "木", "辰": "Tacky", "巳": "火", "午": "火", "未": "Tacky", "申": "金", "酉": "金", "戌": "Tacky", "亥": "水"}
    RELATIONSHIP = {
        "木": {"木": "同", "火": "生", "Tacky": "克", "金": "被克", "水": "被生"},
        "火": {"木": "被生", "火": "同", "Tacky": "生", "金": "克", "水": "被克"},
        "Tacky": {"木": "被克", "火": "被生", "Tacky": "同", "金": "生", "水": "克"},
        "金": {"木": "克", "火": "被克", "Tacky": "被生", "金": "同", "水": "生"},
        "水": {"木": "生", "火": "克", "Tacky": "被克", "金": "被生", "水": "同"}
    }
    TEN_GODS = {
        "同_同": "比肩 (Friend)", "异_同": "劫财 (Rob)",
        "同_生": "食神 (Artist)", "异_生": "伤官 (Rebel)",
        "同_克": "偏财 (Windfall)", "异_克": "正财 (Salary)",
        "同_被克": "七杀 (7-Killings)", "异_被克": "正官 (Officer)",
        "同_被生": "偏印 (Owl)", "异_被生": "正印 (Seal)"
    }

    # --- 1. 排盘 ---
    solar = Solar.fromYmdHms(birth_year, birth_month, birth_day, birth_hour, birth_minute, 0)
    lunar = Lunar.fromSolar(solar)
    ba_zi = lunar.getEightChar()
    day_master = ba_zi.getDayGan()
    dm_element = GAN_WU_XING[day_master]
    dm_yin_yang = "阳" if day_master in ["A", "丙", "戊", "庚", "壬"] else "阴"

    # --- 2. Assist函Count ---
    def get_ten_god(target_gan):
        if not target_gan: return ""
        target_element = GAN_WU_XING.get(target_gan) or ZHI_WU_XING.get(target_gan)
        rel = RELATIONSHIP[dm_element].get(target_element, "同")
        
        # 简化阴阳Triage
        target_yy = "阳" if target_gan in ["A", "丙", "戊", "庚", "壬", "寅", "申", "巳", "亥"] else "阴"
        is_same = (dm_yin_yang == target_yy)
        key = f"{'同' if is_same else '异'}_{rel if rel in ['生','克','被生','被克'] else '同'}"
        return TEN_GODS.get(key, "Unknown")

    # --- 3. 旺衰硬规则 ---
    score = 0
    month_zhi = ba_zi.getMonthZhi()
    m_ele = ZHI_WU_XING[month_zhi]
    
    # 得令 (+40)
    if RELATIONSHIP[dm_element][m_ele] in ["同", "被生"]: score += 40
    elif RELATIONSHIP[dm_element][m_ele] == "被克": score -= 20
    
    # 得地 (+15/each)
    for zhi in [ba_zi.getYearZhi(), ba_zi.getDayZhi(), ba_zi.getTimeZhi()]:
        if ZHI_WU_XING[zhi] == dm_element: score += 15
        
    body_strength = "身强 (Strong)" if score >= 40 else "身弱 (Weak)"
    strength_cn = "身强" if score >= 40 else "身弱"

    # --- 4. 流年 ---
    current_year = datetime.datetime.now().year
    # 简单的流年计算 (以立春为Boundary需要更复杂逻辑，这里简化取当年农历年干支)
    # 修正：直接用 Lunar 获取当年的干支
    current_lunar = Lunar.fromYmd(current_year, 6, 1)
    annual_gan = current_lunar.getYearGan()
    annual_zhi = current_lunar.getYearZhi()
    
    annual_god = get_ten_god(annual_gan)

    return {
        "meta": {
            "solar_date": f"{birth_year}-{birth_month}-{birth_day}",
            "lunar_date": f"{lunar.getYearInChinese()}年{lunar.getMonthInChinese()}月{lunar.getDayInChinese()}"
        },
        "bazi": {
            "day_master": day_master,
            "element": dm_element,
            "strength": strength_cn,
            "score": score
        },
        "fortune": {
            "current_year": f"{current_year} ({annual_gan}{annual_zhi})",
            "year_god": annual_god.split(" ")[0], # 只取Chinese名，如 "七杀"
            "lucky_direction": lunar.getDayPositionCaiDesc() # 财神方位
        }
    }