# 手柄与Seeed小件接口核实

> 2026-09-22 调研 · 结论后附来源

**结论先行**

**1. DualSense × macOS**
- (a) pygame/SDL2：按键/摇杆/扳机开箱即用（SDL HIDAPI PS5 驱动，USB/蓝牙都认；旧 SDL 2.0.20 在 Monterey 上认不到，pygame ≥2.1.3 已修）。`Joystick.rumble()` 存在于 pygame-ce 2.5.9；USB 直连可用，蓝牙需在 `pygame.init()` 前 `os.environ["SDL_JOYSTICK_HIDAPI_PS5_RUMBLE"]="1"`（SDL 文档：默认 0，蓝牙不开则无震动；且必须用环境变量设，Python 里调 hint 无效）。陀螺仪/加速度计：pygame 与 pygame-ce 的 joystick API **都没有传感器接口**，SDL 有 `GetSensorData` 但 pygame 未封装。
  https://github.com/pygame-community/pygame-ce/issues/1524 · https://pyga.me/docs/ref/joystick.html · https://wiki.libsdl.org/SDL2/SDL_HINT_JOYSTICK_HIDAPI_PS5_RUMBLE · https://discourse.libsdl.org/t/sdl2-and-sdl3-joystic-gamepad-rumble-doesnt-work-over-bluetooth/52314
- (b) pydualsense：README 只写 Windows/Linux，但代码走 `hidapi-usb`（cffi 按名 dlopen，含 `libhidapi.dylib`，`platform.startswith('darwin')` 放行）→ macOS 需 `brew install hidapi`。功能有灯条、自适应扳机、震动、陀螺仪/加速度（报告字节 16-27）。macOS 实况：issue #74（M2、macOS 15.5）USB 正常，蓝牙约 15 分钟掉线；issue #40（M1）蓝牙首包只有 10 字节触发 IndexError，两个 issue 均未关闭。
  https://github.com/flok/pydualsense · https://github.com/flok/pydualsense/issues/74 · https://github.com/flok/pydualsense/issues/40 ·（本地解包 hidapi_usb-0.3.2 wheel 核实）
- (c) **USB 直连更稳**：两条路线的 mac 蓝牙问题都集中在震动/掉线/报文格式。比赛用 USB-C 线。

**2. XIAO ESP32-S3**
- 113991114 = **普通版**，无麦克风（wiki 规格表 Built-in Sensors 为 "/"）。Sense 版 SKU **113991115**，带数字麦克风 + OV3660 摄像头 + SD 槽。
  https://www.seeedstudio.com/XIAO-ESP32S3-p-5627.html · https://www.seeedstudio.com/XIAO-ESP32S3-Sense-p-5639.html · https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/

**3. 6x10 RGB Matrix（104030107）**
- 数据脚 **D0**，供电 5V；官方示例 `Adafruit_NeoPixel`，Arduino；wiki 无 CircuitPython 章节。官方**未给全亮电流数字**，只警告多块拼接会"发热/供电不足，需外接 5V"。单块 60 颗按 WS2812B 常规 ~60mA/颗 估算最大 3.6A（我的估算，非官方），实际用低亮度（brightness≤50）走 XIAO 5V（即 USB 5V 直通）够用；全白全亮不要。
  https://wiki.seeedstudio.com/rgb_matrix_for_xiao/ · https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/8932/104030107.pdf

**4. reSpeaker XVF3800**
- SKU：**101991441 = 不带 XIAO**（USB 固件）；**114993700 = 预焊 XIAO ESP32S3**；**114993702 = 带 XIAO + 外壳**。wiki 另出现 114993701，对应哪款未核实。
- mac 声音设置显示名：**"reSpeaker 3800"**（wiki Audacity 截图，Linux 显示 "reSpeaker XVF3800 4-Mic Array"）。
- `xvf_host` 仓库只有 `mac_arm64/`（自带 libusb-1.0.0.dylib，chmod +x 即用）→ **M2 Pro 可用，Intel Mac 无二进制**。
- Python 现成脚本：`python_control/respeaker_get_doa.py`，pyusb + `libusb_package`（pip 自带 libusb，无需 brew），USB 控制传输读 VID 0x2886/PID 0x001A，每秒打印 DoA 与语音检测；两台 Mac 都能跑。
  https://wiki.seeedstudio.com/respeaker_xvf3800_introduction/ · https://www.seeedstudio.com/ReSpeaker-XVF3800-USB-Mic-Array-p-6488.html · https://www.seeedstudio.com/ReSpeaker-XVF3800-4-Mic-Array-With-XIAO-ESP32S3-p-6489.html · https://www.seeedstudio.com/ReSpeaker-XVF3800-With-Case-XIAO-ESP32S3-p-6628.html · https://github.com/respeaker/reSpeaker_XVF3800_USB_4MIC_ARRAY

**5. XIAO 0.96'' IPS Display nRF52840（100063377）**
- 官方入门 = **Arduino IDE**，板包 "Seeed nRF52 Boards" 1.1.13，选 "Seeed XIAO nRF52840 Plus"，显示库 Seeed_GFX2（手动装）。
- IMU **LSM6DS3**（6 轴），PDM 麦克风，ST7789 80×160，按键 D6/D7，无扬声器。
- 电池**不含**，接口 **2-pin JST 2.0**，3.7V 锂电自配。
- BLE：该页无 BLE 示例；nRF52 板包上 ArduinoBLE 与 Adafruit Bluefruit 都可用，连 Mac 最省事是 **NUS（Nordic UART）**，Mac 端用 bleak，不用自定义 profile。
  https://wiki.seeedstudio.com/getting_started_0.96_inch_display_nrf52840/ · https://wiki.seeedstudio.com/display_gadgets/ · https://openelab.io/products/seeed-studio-xiao-0-96-ips-display-nrf52840 · https://wiki.seeedstudio.com/XIAO_BLE/

**要买的东西**：一根 USB-C 数据线（DualSense、XVF3800 都走 USB）；若要屏板离线跑，配一块 JST 2.0 锂电；Matrix 全亮才需外接 5V。