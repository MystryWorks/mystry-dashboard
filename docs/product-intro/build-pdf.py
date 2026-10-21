"""生成 Mystry Dashboard 产品介绍 PDF（中文 + 实拍截图）。"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

HERE = Path(__file__).resolve().parent
SHOTS = HERE / "screenshots"
OUT = HERE / "Mystry-Dashboard-产品介绍.pdf"

BG = colors.HexColor("#12080f")
CARD = colors.HexColor("#22131f")
LINE = colors.HexColor("#4a2a42")
ACCENT = colors.HexColor("#e85aad")
TEXT = colors.HexColor("#f6eaf1")
MUTED = colors.HexColor("#c4a3b4")
HEAD = colors.HexColor("#ffe6f3")
ROW_ALT = colors.HexColor("#1a0d18")
DANGER = colors.HexColor("#ff6b81")

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm


def register_fonts() -> tuple[str, str]:
    candidates = [
        (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\msyhbd.ttc", 0),
        (r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\simhei.ttf", None),
    ]
    for regular, bold, index in candidates:
        if not Path(regular).exists():
            continue
        kwargs = {"subfontIndex": index} if index is not None else {}
        try:
            pdfmetrics.registerFont(TTFont("MYSTRY", regular, **kwargs))
            bold_kwargs = {"subfontIndex": index} if index is not None and Path(bold).exists() else {}
            if Path(bold).exists():
                try:
                    pdfmetrics.registerFont(TTFont("MYSTRY-Bold", bold, **bold_kwargs))
                except Exception:
                    pdfmetrics.registerFont(TTFont("MYSTRY-Bold", regular, **kwargs))
            else:
                pdfmetrics.registerFont(TTFont("MYSTRY-Bold", regular, **kwargs))
            return "MYSTRY", "MYSTRY-Bold"
        except Exception:
            continue
    raise SystemExit("找不到可用的中文字体（需要微软雅黑或黑体）")


FONT, FONT_BOLD = register_fonts()


def styles():
    base = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle(
            "cover_kicker", parent=base["Normal"], fontName=FONT, fontSize=11,
            textColor=ACCENT, alignment=TA_CENTER, leading=16, spaceAfter=8,
        ),
        "cover_title": ParagraphStyle(
            "cover_title", parent=base["Title"], fontName=FONT_BOLD, fontSize=28,
            textColor=HEAD, alignment=TA_CENTER, leading=36, spaceAfter=10,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub", parent=base["Normal"], fontName=FONT, fontSize=13,
            textColor=MUTED, alignment=TA_CENTER, leading=20, spaceAfter=6,
        ),
        "h1": ParagraphStyle(
            "h1", parent=base["Heading1"], fontName=FONT_BOLD, fontSize=16,
            textColor=HEAD, leading=22, spaceBefore=10, spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2", parent=base["Heading2"], fontName=FONT_BOLD, fontSize=13,
            textColor=ACCENT, leading=18, spaceBefore=10, spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body", parent=base["BodyText"], fontName=FONT, fontSize=9.5,
            textColor=TEXT, leading=15, alignment=TA_LEFT, spaceAfter=6,
        ),
        "caption": ParagraphStyle(
            "caption", parent=base["Normal"], fontName=FONT, fontSize=8.5,
            textColor=MUTED, leading=12, alignment=TA_CENTER, spaceBefore=3, spaceAfter=10,
        ),
        "cell": ParagraphStyle(
            "cell", parent=base["Normal"], fontName=FONT, fontSize=8,
            textColor=TEXT, leading=12,
        ),
        "cell_h": ParagraphStyle(
            "cell_h", parent=base["Normal"], fontName=FONT_BOLD, fontSize=8,
            textColor=HEAD, leading=12,
        ),
        "note": ParagraphStyle(
            "note", parent=base["Normal"], fontName=FONT, fontSize=8.5,
            textColor=MUTED, leading=13, spaceAfter=8, leftIndent=4,
        ),
        "toc": ParagraphStyle(
            "toc", parent=base["Normal"], fontName=FONT, fontSize=11,
            textColor=TEXT, leading=20,
        ),
    }


S = styles()


def P(text: str, style: str = "body") -> Paragraph:
    return Paragraph(text.replace("\n", "<br/>"), S[style])


def shot(name: str, caption: str, max_h: float = 118 * mm):
    path = SHOTS / name
    img = ImageReader(str(path))
    iw, ih = img.getSize()
    max_w = PAGE_W - 2 * MARGIN
    scale = min(max_w / iw, max_h / ih)
    w, h = iw * scale, ih * scale
    from reportlab.platypus import Image

    picture = Image(str(path), width=w, height=h)
    picture.hAlign = "CENTER"
    return KeepTogether([picture, P(caption, "caption")])


def table(headers: list[str], rows: list[list[str]], widths: list[float] | None = None):
    usable = PAGE_W - 2 * MARGIN
    if widths is None:
        if len(headers) == 2:
            widths = [usable * 0.28, usable * 0.72]
        elif len(headers) == 3:
            widths = [usable * 0.22, usable * 0.26, usable * 0.52]
        else:
            widths = [usable / len(headers)] * len(headers)
    data = [[P(h, "cell_h") for h in headers]]
    for row in rows:
        data.append([P(cell, "cell") for cell in row])
    grid = Table(data, colWidths=widths, repeatRows=1)
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3a1830")),
        ("TEXTCOLOR", (0, 0), (-1, 0), HEAD),
        ("BACKGROUND", (0, 1), (-1, -1), CARD),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, ACCENT),
        ("LINEBELOW", (0, 1), (-1, -2), 0.25, LINE),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            commands.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    grid.setStyle(TableStyle(commands))
    return grid


def bullets(items: list[str]):
    return ListFlowable(
        [ListItem(P(item), leftIndent=12, bulletColor=ACCENT) for item in items],
        bulletType="bullet",
        start="•",
        leftIndent=14,
        bulletFontName=FONT,
        bulletFontSize=9,
        bulletColor=ACCENT,
    )


def draw_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BG)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(2)
    canvas.line(0, PAGE_H, PAGE_W, PAGE_H)
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT, 8)
    if doc.page > 1:
        canvas.drawString(MARGIN, 9 * mm, "Mystry Dashboard  ·  产品介绍")
        canvas.drawRightString(PAGE_W - MARGIN, 9 * mm, f"{doc.page}")
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.4)
        canvas.line(MARGIN, 12 * mm, PAGE_W - MARGIN, 12 * mm)
    canvas.restoreState()


def build_story():
    story = []

    story += [
        Spacer(1, 42 * mm),
        P("0.2.0-preview.2  ·  单机一体服务端面板", "cover_kicker"),
        P("Mystry Dashboard", "cover_title"),
        P("产品介绍与界面说明书", "cover_sub"),
        P("用浏览器管理本机多个 Minecraft Java 服务端：部署、导入、启停、控制台、文件与配置。", "cover_sub"),
        Spacer(1, 8 * mm),
        shot("04-dashboard.png", "实例总览（Mystry 暗色主题）", max_h=95 * mm),
        P("本文截图来自真实运行界面。图中实例名（生存服、已有服务器、自定义 Jar 实例）、任务时间与主机指标属于拍摄时的临时环境，不是内置示例服。", "note"),
        PageBreak(),
        P("目录", "h1"),
        P("1. 产品定位与边界", "toc"),
        P("2. 登录与主题", "toc"),
        P("3. 全局壳层与任务中心", "toc"),
        P("4. 实例总览", "toc"),
        P("5. 一键部署", "toc"),
        P("6. 导入已有服务端", "toc"),
        P("7. 节点监控", "toc"),
        P("8. 实例详情：控制台 / 文件管理 / 参数配置 / 实例设置 &amp; JVM", "toc"),
        P("9. Java 运行时与 JVM 配置器", "toc"),
        P("10. 窄屏布局与确认弹窗", "toc"),
        P("11. 数据位置、安全边界与按钮总表", "toc"),
        PageBreak(),
    ]

    story += [
        P("1. 产品定位与边界", "h1"),
        P("Mystry Dashboard 是跑在你自己电脑上的 Web 管理面板，用来管理 Minecraft <b>Java 服务端</b>进程。它不是游戏客户端，也不是 Fabric / Forge 模组，更不是已经开放的远程多机 Agent 控制台。", "body"),
        P("默认访问地址：开发模式 <font face='Courier'>http://127.0.0.1:5173</font>，生产或便携包 <font face='Courier'>http://127.0.0.1:3000</font>。默认只监听本机，外网不能直接打开。", "body"),
        P("能做什么", "h2"),
        bullets([
            "多实例启动、停止、重启、强制停止、删除",
            "一键部署 Vanilla / Paper / Fabric / Forge / NeoForge",
            "从固定交接区复制已有服务端，或上传 ZIP（先预检再导入）",
            "创建空目录后自行上传 server.jar",
            "实时控制台、实例目录文件管理、引导式 server.properties",
            "统一 JVM 配置器；扫描并绑定本机 Java（不能手填路径）",
            "任务中心跟踪部署/导入；三套主题各含暗色和亮色",
        ]),
        Spacer(1, 3 * mm),
        P("明确不做", "h2"),
        bullets([
            "不启动 Minecraft 客户端窗口，不浏览整台电脑",
            "不能指定任意安装路径；实例只存在 DATA_DIR/instances/&lt;id&gt;",
            "远程节点创建当前关闭，只有内置本机节点 local",
            "没有多管理员、角色权限、2FA；重启后面板不会续跑未完成任务",
            "不自动安装 Java",
        ]),
        PageBreak(),
    ]

    story += [
        P("2. 登录与主题", "h1"),
        P("未登录、会话失效，或尚未创建管理员时进入登录页。日常标题为「登录面板」；用户表为空时变为「初始化管理员」，并要求填写 64 位 SETUP_TOKEN。", "body"),
        shot("03-login-dark.png", "登录页 · Mystry 暗色"),
        shot("01-login.png", "登录页 · Mystry 亮色"),
        table(
            ["控件", "说明"],
            [
                ["调色板", "打开主题选择器。选择保存在本浏览器 localStorage（mystry_theme）。"],
                ["用户名", "默认 admin。初始化时即所创管理员名。"],
                ["初始化令牌", "仅首次出现，必须与服务器 SETUP_TOKEN 完全一致。"],
                ["密码", "日常登录非空即可；初始化至少 12 位。"],
                ["登录 / 创建并进入", "提交。处理中锁定，防止连点。"],
                ["重新检查", "面板连不上时出现，重试 /api/auth/status。"],
            ],
        ),
        Spacer(1, 3 * mm),
        P("登录成功后 token 存在 mystry_token。任一业务接口 401 会清掉登录态并回到本页。", "body"),
        shot("02-login-theme-picker.png", "主题选择器：Mystry / Codex / Grok，各有暗色与亮色"),
        table(
            ["选项", "说明"],
            [
                ["Mystry 暗色 / 亮色", "产品默认粉紫套装。未保存过主题时仅在这对之间跟随系统外观。"],
                ["Codex 暗色 / 亮色", "暖灰青绿。"],
                ["Grok 暗色 / 亮色", "近黑或白底高对比。"],
            ],
        ),
        P("控制台终端区域始终保持暗色，不受亮色主题影响。Escape 关闭选择器。", "note"),
        PageBreak(),
    ]

    story += [
        P("3. 全局壳层与任务中心", "h1"),
        P("登录后左侧是固定导航，右侧是顶栏和当前页面。窄屏约 ≤1024px 时侧栏收成抽屉，由顶栏菜单图标打开。", "body"),
        table(
            ["入口", "路由", "作用"],
            [
                ["实例总览", "/", "主机指标与所有实例的状态、快捷操作"],
                ["一键部署", "/deploy", "从官方源下载核心并创建实例"],
                ["导入服务端", "/import", "同机目录直接交接，或 ZIP 服务端整合包导入"],
                ["节点监控", "/nodes", "查看本机节点与运行环境；远程创建未开放"],
                ["当前工作台", "/instances/&lt;id&gt;", "控制台 / 文件管理 / 参数配置 / 实例设置 &amp; JVM"],
            ],
        ),
        Spacer(1, 3 * mm),
        table(
            ["控件", "说明"],
            [
                ["侧栏导航", "主控集群（实例总览、详情页时的当前工作台）与部署与维护（一键部署、导入服务端、节点监控），当前页高亮。"],
                ["任务队列（顶栏）", "打开右侧任务中心。徽标显示进行中任务数，没有时以灰色显示最近任务总数。"],
                ["调色板（顶栏）", "打开主题选择器。"],
                ["用户名", "只读，当前登录账号（本机主控权限）。"],
                ["登出图标", "清除本浏览器 token，回到登录页。不停止正在运行的 Minecraft 进程。"],
                ["菜单 / 关闭图标", "窄屏打开或关闭侧栏。Escape 或点遮罩关闭。"],
            ],
        ),
        Spacer(1, 4 * mm),
        P("任务中心", "h2"),
        P("离开部署或导入页后，任务仍会轮询到「已完成」或「失败」。页面隐藏时暂停；遇到 429 会退避。", "body"),
        shot("09-task-center.png", "点顶栏「任务队列」从右侧滑出后台异步任务中心"),
        table(
            ["控件", "说明"],
            [
                ["刷新 / 关闭图标", "立即刷新任务；关闭面板（也可 Escape 或点外部）。"],
                ["类型标签", "下载核心 / 解压文件 / 部署实例 / 导入服务端。"],
                ["状态", "排队中、进行中（带百分比）、已完成、失败。"],
                ["进度条", "仅排队中、进行中显示，数值限制在 0–100。"],
                ["查看实例 →", "任务结果带 instanceId 时出现，失败但已落地也可点。"],
                ["过期提示", "轮询失败时提示状态可能已过期及上次成功同步时间，可点刷新重试。"],
            ],
        ),
        P("任务元数据在 SQLite，队列在内存。重启面板不会续跑，遗留的 pending / running 会被标为失败。", "note"),
        PageBreak(),
    ]

    story += [
        P("4. 实例总览", "h1"),
        P("实例列表约每 3 秒刷新，主机指标约每 5 秒刷新。首次加载会显示读取状态；刷新失败时保留上次数据并提示可能已过期。列表标题右侧固定保留「一键部署」和「导入服务端」两个主入口；上传自定义 Jar 走次级「创建空实例」。", "body"),
        shot("04-dashboard.png", "实例总览：主机指标卡片 + 实例卡片"),
        table(
            ["区域", "说明"],
            [
                ["指标卡片", "实例状态（运行中 / 总数、已停止、异常）、主机 CPU、主机内存、数据盘空间；「刷新」立即重新采样，「异常 N」只看异常实例。"],
                ["名称", "点击进入该实例工作台。"],
                ["核心 · 版本", "PAPER / FABRIC / VANILLA / FORGE / NEOFORGE / CUSTOM，后接 Minecraft 版本。"],
                ["状态", "已停止、启动中、运行中、停止中、已崩溃、待迁移。"],
                ["进程 CPU / 内存、Xmx、Java 运行时", "进程指标仅存活时有值；未绑定运行时显示「系统默认」。"],
            ],
        ),
        Spacer(1, 3 * mm),
        P("卡片按钮何时可点", "h2"),
        table(
            ["按钮", "何时可点", "做什么"],
            [
                ["进入管理", "始终", "进入实例工作台。"],
                ["启动", "已停止或已崩溃，且非待迁移", "拉起 Java 进程，先占位「启动中」。"],
                ["停止", "仅运行中", "向进程写 stop，不会隐式强杀。"],
                ["更多操作（三点图标）", "始终", "展开重启实例、强制停止、删除实例。"],
            ],
        ),
        Spacer(1, 3 * mm),
        shot("05-dashboard-more-actions.png", "更多操作：已停止时强制停止禁用（桌面宽度下菜单需在卡片内滚动查看）"),
        table(
            ["更多操作", "何时可点", "做什么"],
            [
                ["重启实例", "非启动中 / 停止中", "确认后先停再启，会踢掉在线玩家。"],
                ["强制停止", "运行中 / 启动中 / 停止中", "确认后 SIGKILL。可能导致世界损坏。"],
                ["删除实例", "进程未存活（待迁移除外）", "确认后删除记录和实例目录。运行中禁止。"],
            ],
        ),
        Spacer(1, 3 * mm),
        shot("06-dashboard-delete-confirm.png", "删除托管实例必须原样输入实例名"),
        table(
            ["控件", "说明"],
            [
                ["确认文本框", "必须输入与实例名完全一致的文字。"],
                ["取消", "关闭。执行期间禁用，Escape 和点遮罩也不能绕过。"],
                ["永久删除", "删除数据库记录和 instances/&lt;id&gt; 全部文件，不可恢复。"],
                ["移除记录", "仅待迁移实例：只删面板记录，不动旧外部目录。"],
            ],
        ),
        Spacer(1, 3 * mm),
        P("创建空实例", "h2"),
        shot("07-create-empty-dialog.png", "创建空实例：成功后跳到文件页上传 server.jar"),
        table(
            ["控件", "说明"],
            [
                ["实例名称", "默认「自定义 Jar 实例」。"],
                ["Java 运行时 / 重新探测", "默认 PATH 中的 java，或选择已验证运行时。"],
                ["JVM 设置", "与部署、导入、设置共用同一配置器。"],
                ["自动接受 EULA", "勾选后启动时写 eula=true。"],
                ["创建并前往文件页", "创建 custom 实例。JVM 有错误时禁用。"],
            ],
        ),
        PageBreak(),
    ]

    story += [
        P("5. 一键部署", "h1"),
        P("从官方源拉取 Vanilla / Paper / Fabric / Forge / NeoForge，在 DATA_DIR/instances/&lt;新ID&gt; 创建实例。表单不能填写安装路径。", "body"),
        shot("10-deploy.png", "一键部署表单（尚未选择核心）"),
        shot("11-deploy-paper.png", "选择 Paper 1.21.11 后出现 Build 下拉，并提示推荐 Java 21"),
        table(
            ["控件", "说明"],
            [
                ["1. 核心类型卡片", "Paper / Fabric / Forge / NeoForge / Vanilla。切换会清空后续版本字段。"],
                ["2. 实例名称", "总览里显示的名字，默认「我的服务器」。"],
                ["3. 游戏版本", "打开下拉时才向官方源拉列表。"],
                ["4. Paper Build / Loader / Installer", "随核心类型出现。Fabric 另需 Installer 版本。"],
                ["Java 运行时 + 重新探测", "所选运行时用于 Forge/NeoForge Installer 和以后启动。"],
                ["EULA 同意勾选", "默认勾选，启动时写 eula=true。"],
                ["立即开始自动化部署", "未选齐或 JVM 非法时禁用。提交后锁定为「部署任务运行中…」。"],
                ["进度条", "0–100%。可离开本页，到任务中心继续看。"],
                ["复制错误 / 查看详情", "失败后复制摘要或打开完整错误。"],
            ],
        ),
        P("Forge / NeoForge 会执行官方 --installServer，耗时可能很长。任务可能先排队；成功后自动跳到新实例控制台。队列满返回 429。", "note"),
        PageBreak(),
    ]

    story += [
        P("6. 导入已有服务端", "h1"),
        P("两种方式都会再复制一份到新的 instances/&lt;id&gt;，不会让实例在原目录运行，也不会删除源目录。", "body"),
        P("同机目录直接交接", "h2"),
        shot("12-import-directory.png", "只列出 DATA_DIR/imports 的直接子目录（图中为示例目录 old-survival），不接受绝对路径"),
        table(
            ["控件", "说明"],
            [
                ["同机目录直接交接 / ZIP 服务端整合包导入", "切换导入方式。"],
                ["选择检测到的交接目录", "显示为「目录名 · 启动目标」。不可用项禁用并显示原因。"],
                ["刷新目录", "重新扫描交接区。"],
                ["复制并接管", "入队后台复制。成功后跳转实例页。"],
            ],
        ),
        P("请先正常停止原服务器再复制。运行中复制可能得到不一致的世界数据。复制会拒绝 symlink、特殊文件、面板实例标记、超配额和磁盘不足。", "note"),
        P("ZIP 服务端整合包导入", "h2"),
        shot("13-import-zip.png", "ZIP 分两步：先预检，再确认配置并导入"),
        table(
            ["控件", "说明"],
            [
                ["服务端压缩包 (.zip) / 选择 ZIP", "拖拽或选择文件。大约 512 MiB 上限，同时受 ZIP 配额限制。"],
                ["上传并预检", "校验中央目录，只读根目录或单层目录中最大 64 KiB 的 user_jvm_args.txt。"],
                ["取消并重新选择", "立刻丢掉临时包，不写数据库。"],
                ["确认配置并导入", "预检成功且 JVM 合法后入队。"],
            ],
        ),
        P("预览默认 30 分钟、按用户隔离。刷新页面会从 sessionStorage 恢复未过期预览。过期、取消或重启面板后需要重新上传。", "note"),
        PageBreak(),
    ]

    story += [
        P("7. 节点监控", "h1"),
        P("当前所有实例都跑在本机。远程节点创建由开关关闭，页面没有「添加远程节点」。约每 5 秒刷新。", "body"),
        shot("14-nodes.png", "仅内置本机节点在线；下方说明远程多机集群尚未开放"),
        table(
            ["区域 / 控件", "说明"],
            [
                ["本机节点卡片", "节点名、在线 / 离线徽章；加载失败时显示状态可能已过期。"],
                ["运行环境", "宿主操作系统平台、CPU 架构 / 线程数、物理内存总量。"],
                ["已挂载实例数", "挂在本机节点上的实例数量。"],
                ["其他节点列表 / 删除", "仅存在历史远程记录时出现；实例数为 0 才可删，并二次确认。"],
                ["重试加载", "列表加载失败时出现。"],
            ],
        ),
        PageBreak(),
    ]

    story += [
        P("8. 实例详情", "h1"),
        P("页面标题为「实例工作台」。顶部卡片显示实例名、状态和「核心 · 版本 · 节点」，生命周期按钮在所有 Tab 共用。待迁移实例不显示 Tab，只显示「接管托管目录」：你必须先用系统工具把旧目录复制到 DATA_DIR/instances/&lt;id&gt;，面板不会读或删旧目录。", "body"),
        table(
            ["按钮", "何时可点", "做什么"],
            [
                ["←（返回总览）", "始终", "回到实例列表。"],
                ["启动", "已停止或已崩溃时显示", "拉起进程。"],
                ["停止", "仅运行中显示", "普通停止，写 stop。"],
                ["重启", "非启动中 / 停止中", "确认后先停再启。"],
                ["强制停止", "运行中 / 启动中 / 停止中", "确认后立即结束进程。"],
                ["四个 Tab", "非待迁移", "控制台 / 文件管理 / 参数配置 / 实例设置 &amp; JVM。"],
            ],
        ),
        P("控制台", "h2"),
        shot("15-instance-console.png", "控制台：运行中的 Paper 1.21.11 示例服，末行为发送 list 后的回显"),
        table(
            ["控件", "说明"],
            [
                ["状态条 / 清空屏幕 / 复制日志", "显示 WebSocket 连接状态；清空本地显示；复制全部输出。"],
                ["终端区域", "xterm.js。INFO 绿、WARN 黄、ERROR 红。先回放历史再跟实时输出。"],
                ["命令输入", "仅运行中可发送；停止时占位「实例已停止，启动后可发送指令」。"],
                ["发送 / 常用命令快捷键", "把输入发给服务端 stdin，等价回车，方向键翻历史；快捷键一键发送 list、save-all、tps 等。"],
            ],
        ),
        P("控制台使用短期一次性 WebSocket ticket。断线后 1 秒到 30 秒指数退避自动重连。", "note"),
        P("文件管理", "h2"),
        shot("16-instance-files.png", "文件列表限定在当前实例根目录"),
        shot("17-file-editor.png", "编辑文本文件：关闭或取消不保存"),
        table(
            ["控件", "说明"],
            [
                ["上级", "回到实例内父目录；根目录禁用。"],
                ["上传", "传到当前逻辑目录。"],
                ["文件夹名", "点击进入该目录。"],
                ["下载", "仅普通文件。一次性 ticket + 浏览器原生下载，不用 blob() 整包缓存。"],
                ["重命名", "仅同目录改名。目标已存在返回 409，不覆盖。"],
                ["编辑", "非目录且不超过约 1 MiB。"],
                ["删除", "文件夹会递归删除，确认框写明逻辑路径。"],
                ["创建", "在当前目录新建文件夹。"],
                ["保存 / 取消 / 关闭", "写回磁盘或放弃未保存修改。"],
            ],
        ),
        P("参数配置", "h2"),
        shot("18-instance-config.png", "server.properties 按基础 / 多人 / 世界 / 性能分组"),
        shot("19-instance-config-advanced.png", "未收录的键留在高级选项，仍可编辑"),
        table(
            ["控件", "说明"],
            [
                ["分组字段", "只改每个 key 的最后一次定义；保留注释、空行、重复键。"],
                ["保存配置", "无修改时禁用。成功后提示需重启实例才生效。"],
                ["离开确认", "有未保存修改时切页会询问；关标签页走 beforeunload。"],
            ],
        ),
        P("实例设置 &amp; JVM", "h2"),
        shot("20-instance-settings.png", "窄屏下的实例设置：安装路径只读；JVM 非法时不能保存"),
        table(
            ["控件", "说明"],
            [
                ["名称 / Jar 文件名", "可改。Jar 是相对实例目录的文件名。"],
                ["安装路径", "只读，DATA_DIR/instances/&lt;id&gt;。"],
                ["Java 运行时", "绑定已验证运行时，或保持 PATH 默认。"],
                ["启动时写入 eula=true", "每次启动写 eula.txt。"],
                ["保存设置", "无变化、保存中或 JVM 非法时禁用。"],
            ],
        ),
        P("旧实例若已有非法 JVM 文本会保持原样，但修正前不能保存或启动。", "note"),
        PageBreak(),
    ]

    story += [
        P("9. Java 运行时与 JVM 配置器", "h1"),
        P("Java 选择器和 JVM 配置器出现在四个入口：创建空实例、一键部署、导入、实例设置。", "body"),
        P("Java 运行时", "h2"),
        table(
            ["控件", "说明"],
            [
                ["PATH 状态条", "默认 java 是否可用及版本。"],
                ["下拉框", "默认 PATH + 面板扫描到的条目。不可用项禁用。"],
                ["重新探测", "扫描 JAVA_HOME 和常见安装目录。候选必须名为 java/java.exe，且 -version 可解析。"],
                ["版本告警", "1.20.5+ 建议 Java 21；1.17–1.20.4 建议 17；更早建议 8。"],
            ],
        ),
        P("请求只能提交运行时 ID，不能提交可执行路径。启动和 Forge/NeoForge Installer 执行前会再验证。子进程环境会脱敏，不把面板密钥或 DATA_DIR 传给 Java。", "note"),
        P("JVM 配置器", "h2"),
        shot("08-jvm-advanced.png", "高级区可手动 Xms 和附加参数；下方是最终参数预览"),
        table(
            ["控件", "说明"],
            [
                ["最大内存", "推荐约为本机内存 25%，按 512 MiB 取整，通常 2–8 GiB。"],
                ["兼容优先", "只要内存。Xms 自动取 min(1 GiB, Xmx)。"],
                ["G1 均衡", "需已识别 Java 8 / 17 / 21。"],
                ["Paper Aikar", "仅 Paper + 上述 Java，且强制 Xms=Xmx。低于 6 GiB 会警告。"],
                ["自定义", "不附加预设。"],
                ["手动 Xms / 附加参数", "不要重复填写 -jar、classpath、nogui、@argfile。"],
                ["最终参数", "只读预览即将保存的字符串。"],
            ],
        ),
        P("导入若检测到 user_jvm_args.txt，必须先选：沿用检测参数、使用面板推荐、或自定义。解析失败则不能沿用。有错误级诊断时，保存 / 部署 / 导入 / 启动都会拒绝。", "body"),
        PageBreak(),
    ]

    story += [
        P("10. 窄屏布局与确认弹窗", "h1"),
        shot("21-dashboard-mobile.png", "约 ≤768px 时指标两列、实例卡片单列"),
        shot("22-mobile-nav.png", "顶栏菜单图标打开侧栏抽屉，主区域不可点"),
        table(
            ["控件", "说明"],
            [
                ["菜单 / 关闭图标", "打开或关闭抽屉。焦点在侧栏内循环，Escape 关闭。"],
                ["顶栏任务队列 / 调色板", "与桌面共用同一套状态，不重复轮询。"],
                ["卡片操作", "启动、进入管理、更多操作的启用规则与桌面相同；更多操作在卡片内直接展开。"],
            ],
        ),
        Spacer(1, 3 * mm),
        P("通用确认弹窗替代浏览器原生 confirm。重启、强制停止、删除实例 / 文件 / 远程节点都走它。", "body"),
        table(
            ["控件", "说明"],
            [
                ["取消", "关闭。busy 时禁用，此时 Escape 和点遮罩也不能关。"],
                ["确认", "文案随场景变化；危险操作为红色。"],
                ["输入实例名", "删除托管实例时必填，必须完全一致。"],
            ],
        ),
        PageBreak(),
    ]

    story += [
        P("11. 数据位置、安全边界与按钮总表", "h1"),
        table(
            ["内容", "默认位置"],
            [
                ["实例元数据", "DATA_DIR/panel.db"],
                ["实例文件", "DATA_DIR/instances/&lt;id&gt;/"],
                ["交接复制源", "DATA_DIR/imports/&lt;目录名&gt;/（只读源，不是运行目录）"],
                ["部署/导入半成品", "DATA_DIR/.mystry-staging/&lt;taskId&gt;/&lt;instanceId&gt;/"],
                ["核心缓存", "DATA_DIR/cache/cores/"],
                ["面板锁", "DATA_DIR/.mystry-panel-lock/（同一数据根只允许一个面板进程）"],
            ],
        ),
        Spacer(1, 3 * mm),
        P("崩溃恢复只清理 marker 匹配的 staging，不会因为任务结果里的 instanceId 去删已经注册的实例。JWT_SECRET、SETUP_TOKEN、LAUNCHER_TOKEN 必须是互不相同的 64 位十六进制值。", "body"),
        P("登录与壳层", "h2"),
        table(
            ["按钮", "作用"],
            [
                ["主题 / 六套选项", "切换 Mystry、Codex、Grok 的暗色或亮色。"],
                ["登录 / 创建并进入 / 重新检查", "提交账号，或重试连接。"],
                ["侧栏导航", "实例总览、一键部署、导入服务端、节点监控；详情页另有当前工作台。"],
                ["任务队列 / 调色板 / 登出图标", "任务中心、主题、清 token。"],
                ["菜单 / 关闭图标", "窄屏抽屉。"],
                ["刷新 / 查看实例", "任务刷新或失败重试；跳到已落地实例。"],
            ],
        ),
        P("总览与创建", "h2"),
        table(
            ["按钮", "作用"],
            [
                ["一键部署 / 导入服务端", "进入对应创建流程。"],
                ["创建空实例", "打开对话框，成功后去文件页。"],
                ["进入管理 / 启动 / 停止", "进入详情或当前可执行的启停。"],
                ["重启实例 / 强制停止 / 删除实例", "在更多操作（三点图标）里，确认后执行。"],
                ["刷新 / 异常 N", "重新采样主机指标；只看异常实例。"],
            ],
        ),
        P("部署、导入、节点", "h2"),
        table(
            ["按钮", "作用"],
            [
                ["核心类型卡片 / 立即开始自动化部署", "选核心；入队下载安装。"],
                ["复制错误 / 查看详情 / 复制全部 / 关闭", "失败排错。"],
                ["刷新目录 / 复制并接管", "同机交接。"],
                ["选择 ZIP / 上传并预检 / 确认配置并导入 / 取消并重新选择", "ZIP 二阶段。"],
                ["重新探测", "重扫本机 Java。"],
                ["节点删除 / 重试加载", "历史空远程节点，或列表失败。"],
            ],
        ),
        P("实例工作区", "h2"),
        table(
            ["按钮", "作用"],
            [
                ["← / 启动 / 停止 / 重启 / 强制停止", "返回总览与进程控制。"],
                ["控制台 / 文件管理 / 参数配置 / 实例设置 &amp; JVM", "四个工作区。"],
                ["接管托管目录", "仅待迁移实例。"],
                ["发送 / 常用命令快捷键 / 清空屏幕 / 复制日志", "控制台。"],
                ["上级 / 上传 / 下载 / 重命名 / 编辑 / 删除 / 创建", "文件。"],
                ["保存配置 / 保存设置", "写 server.properties 或实例元数据。"],
                ["放弃修改并离开", "未保存导航确认。"],
            ],
        ),
        Spacer(1, 6 * mm),
        P("延伸阅读", "h2"),
        P("安装与便携包见《快速开始》；第一次开服见《分步教程》；字段排错见《使用指南》；环境变量见《配置说明》。远程 Agent、自动备份、多用户权限尚未交付，不要当成已发布功能。", "body"),
        Spacer(1, 8 * mm),
        P("Mystry Dashboard  ·  0.2.0-preview.2  ·  本文对应仓库当前界面实现。", "caption"),
    ]
    return story


def main() -> None:
    missing = [p.name for p in SHOTS.glob("*.png")]
    if not missing:
        raise SystemExit(f"没有找到截图：{SHOTS}")
    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="Mystry Dashboard 产品介绍",
        author="Mystry Dashboard",
        subject="各页面实拍与按钮说明",
    )
    doc.build(build_story(), onFirstPage=draw_page, onLaterPages=draw_page)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
