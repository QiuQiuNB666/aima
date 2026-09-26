param([switch]$Play, [switch]$CheckInput, [switch]$Extended)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public static class GlassesAudioTest {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct OutCaps {
        public ushort manufacturer, product;
        public uint version;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name;
        public uint formats;
        public ushort channels, reserved;
        public uint support;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct InCaps {
        public ushort manufacturer, product;
        public uint version;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name;
        public uint formats;
        public ushort channels, reserved;
    }
    [StructLayout(LayoutKind.Sequential, Pack=2)]
    struct WaveFormat {
        public ushort tag, channels;
        public uint sampleRate, bytesPerSecond;
        public ushort blockAlign, bits, extra;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct WaveHeader {
        public IntPtr data;
        public uint length, bytesRecorded;
        public UIntPtr user;
        public uint flags, loops;
        public IntPtr next;
        public UIntPtr reserved;
    }
    public class Device {
        public uint Id {get;set;}
        public string Direction {get;set;}
        public string Name {get;set;}
        public ushort Channels {get;set;}
    }
    [DllImport("winmm.dll")] static extern uint waveOutGetNumDevs();
    [DllImport("winmm.dll", CharSet=CharSet.Unicode)] static extern uint waveOutGetDevCapsW(UIntPtr id, out OutCaps caps, uint size);
    [DllImport("winmm.dll")] static extern uint waveInGetNumDevs();
    [DllImport("winmm.dll", CharSet=CharSet.Unicode)] static extern uint waveInGetDevCapsW(UIntPtr id, out InCaps caps, uint size);
    [DllImport("winmm.dll")] static extern uint waveInOpen(out IntPtr handle, uint id, ref WaveFormat format, UIntPtr callback, UIntPtr instance, uint flags);
    [DllImport("winmm.dll")] static extern uint waveInClose(IntPtr handle);
    [DllImport("winmm.dll")] static extern uint waveOutOpen(out IntPtr handle, uint id, ref WaveFormat format, UIntPtr callback, UIntPtr instance, uint flags);
    [DllImport("winmm.dll")] static extern uint waveOutPrepareHeader(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] static extern uint waveOutWrite(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] static extern uint waveOutReset(IntPtr handle);
    [DllImport("winmm.dll")] static extern uint waveOutUnprepareHeader(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] static extern uint waveOutClose(IntPtr handle);
    [DllImport("winmm.dll")] static extern uint waveOutGetVolume(IntPtr handle, out uint volume);

    public static Device[] Devices() {
        var devices = new List<Device>();
        for (uint i=0; i<waveOutGetNumDevs(); i++) {
            OutCaps c;
            if (waveOutGetDevCapsW((UIntPtr)i, out c, (uint)Marshal.SizeOf(typeof(OutCaps)))==0)
                devices.Add(new Device {Id=i, Direction="Output", Name=c.name, Channels=c.channels});
        }
        for (uint i=0; i<waveInGetNumDevs(); i++) {
            InCaps c;
            if (waveInGetDevCapsW((UIntPtr)i, out c, (uint)Marshal.SizeOf(typeof(InCaps)))==0)
                devices.Add(new Device {Id=i, Direction="Input", Name=c.name, Channels=c.channels});
        }
        return devices.ToArray();
    }
    static void Check(uint result, string operation) {
        if (result!=0) throw new Exception(operation+" failed, MMRESULT="+result);
    }
    public static string CheckInput(uint deviceId) {
        Device chosen = Array.Find(Devices(), d => d.Direction=="Input" && d.Id==deviceId && System.Text.RegularExpressions.Regex.IsMatch(d.Name, @"E06-003B(?![A-Z0-9])", System.Text.RegularExpressions.RegexOptions.IgnoreCase));
        if(chosen==null) throw new Exception("Target glasses input no longer exists.");
        WaveFormat format=new WaveFormat {tag=1,channels=1,sampleRate=16000,bytesPerSecond=32000,blockAlign=2,bits=16,extra=0};
        IntPtr handle=IntPtr.Zero;
        try {
            Check(waveInOpen(out handle,deviceId,ref format,UIntPtr.Zero,UIntPtr.Zero,0),"waveInOpen");
            return "INPUT_OPEN_OK: "+chosen.Name+"; requested 16kHz mono PCM; no recording started or samples collected";
        } finally {
            if(handle!=IntPtr.Zero) Check(waveInClose(handle),"waveInClose");
        }
    }
    public static string Play(uint deviceId, bool extended) {
        // Exactly the selected output; never the system default or mapper.
        Device chosen = Array.Find(Devices(), d => d.Direction=="Output" && d.Id==deviceId && System.Text.RegularExpressions.Regex.IsMatch(d.Name, @"E06-003B(?![A-Z0-9])", System.Text.RegularExpressions.RegexOptions.IgnoreCase));
        if (chosen==null) throw new Exception("Target glasses output no longer exists.");
        const int rate=44100;
        const int channels=2;
        double seconds=extended?8.5:1.4;
        int frames=(int)(rate*seconds);
        byte[] pcm=new byte[frames*channels*2];
        for(int i=0;i<frames;i++) {
            double t=(double)i/rate, local=-1, hz=0;
            if(extended) {
                double[] starts={2.5,3.5,5.5,6.5};
                for(int k=0;k<starts.Length;k++)
                    if(t>=starts[k] && t<starts[k]+0.35) {local=t-starts[k];hz=(k%2==0)?523.25:659.25;}
            } else {
                if(t>=0.2 && t<0.55) {local=t-0.2;hz=523.25;}
                if(t>=0.75 && t<1.10) {local=t-0.75;hz=659.25;}
            }
            double envelope=local<0?0:Math.Min(1,Math.Min(local/0.03,(0.35-local)/0.03));
            short value=(short)(32767*0.04*envelope*Math.Sin(2*Math.PI*hz*Math.Max(0,local)));
            for(int c=0;c<channels;c++) {int p=(i*channels+c)*2;pcm[p]=(byte)(value&255);pcm[p+1]=(byte)((value>>8)&255);}
        }
        WaveFormat format=new WaveFormat {tag=1,channels=channels,sampleRate=rate,bytesPerSecond=rate*channels*2,blockAlign=channels*2,bits=16,extra=0};
        IntPtr handle=IntPtr.Zero, data=IntPtr.Zero, header=IntPtr.Zero;
        bool prepared=false;
        uint size=(uint)Marshal.SizeOf(typeof(WaveHeader));
        try {
            Check(waveOutOpen(out handle, deviceId, ref format, UIntPtr.Zero, UIntPtr.Zero, 0),"waveOutOpen");
            uint outputVolume;
            uint volumeResult=waveOutGetVolume(handle,out outputVolume);
            string volumeInfo=volumeResult==0?String.Format("left {0:F1}%, right {1:F1}%",(outputVolume&65535)*100.0/65535,((outputVolume>>16)&65535)*100.0/65535):"unavailable (MMRESULT="+volumeResult+")";
            data=Marshal.AllocHGlobal(pcm.Length);
            Marshal.Copy(pcm,0,data,pcm.Length);
            header=Marshal.AllocHGlobal((int)size);
            Marshal.StructureToPtr(new WaveHeader {data=data,length=(uint)pcm.Length},header,false);
            Check(waveOutPrepareHeader(handle,header,size),"waveOutPrepareHeader");
            prepared=true;
            Check(waveOutWrite(handle,header,size),"waveOutWrite");
            for(int n=0;n<(int)((seconds+6)*20);n++) {
                Thread.Sleep(50);
                WaveHeader current=(WaveHeader)Marshal.PtrToStructure(header,typeof(WaveHeader));
                if((current.flags&1)!=0) {
                    Thread.Sleep(750);
                    return "PLAYBACK_BUFFER_COMPLETED: "+chosen.Name+"; "+seconds+" seconds; PCM peak 4%; waveOut volume "+volumeInfo+"; system defaults unchanged";
                }
            }
            throw new Exception("Audio buffer did not finish within expected duration plus 6 seconds.");
        } finally {
            if(handle!=IntPtr.Zero) {
                waveOutReset(handle);
                if(prepared) waveOutUnprepareHeader(handle,header,size);
                waveOutClose(handle);
            }
            if(header!=IntPtr.Zero) Marshal.FreeHGlobal(header);
            if(data!=IntPtr.Zero) Marshal.FreeHGlobal(data);
        }
    }
}
'@
$devices = [GlassesAudioTest]::Devices()
if (-not $Play -and -not $CheckInput) { $devices | Where-Object { $_.Name -match 'E06-003B(?![A-Z0-9])' } | ConvertTo-Json -Depth 3 }
if ($Play) {
    $target = $devices | Where-Object { $_.Direction -eq 'Output' -and $_.Name -match 'E06-003B(?![A-Z0-9])' -and $_.Name -notmatch 'Hands-Free' } | Select-Object -First 1
    if ($null -eq $target) { throw 'E06-003B playback device not found; no sound sent.' }
    [GlassesAudioTest]::Play($target.Id, $Extended.IsPresent)
}
if ($CheckInput) {
    $target = $devices | Where-Object { $_.Direction -eq 'Input' -and $_.Name -match 'E06-003B(?![A-Z0-9])' } | Select-Object -First 1
    if ($null -eq $target) { throw 'E06-003B microphone device not found.' }
    [GlassesAudioTest]::CheckInput($target.Id)
}
