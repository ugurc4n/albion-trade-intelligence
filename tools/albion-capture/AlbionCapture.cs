// AlbionCapture.cs
//
// Reads the game traffic that Albion Online RECEIVES from its game server (UDP source port 5056) and forwards
// the raw payloads to the Albion Trade Intelligence app (/api/damage/ingest). That is all it does:
//   - it never sends anything to the game or the game server,
//   - it never modifies, injects or blocks packets, and never touches the game process or its files,
//   - the only network connection it opens is the HTTP POST to the app URL you give it.
//
// Build on Windows with the C# compiler that ships with the .NET Framework (no downloads needed):
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:AlbionCapture.exe AlbionCapture.cs
//
// Run from an Administrator command prompt (Windows only allows raw sockets for administrators):
//   .\AlbionCapture.exe http://<app-ip>:3100     (PowerShell needs the leading .\)
//
// Written in C# 5 on purpose so the built-in compiler accepts it.

using System;
using System.Collections.Generic;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Principal;
using System.Text;
using System.Threading;

namespace AlbionCapture
{
    internal static class Program
    {
        private const int GamePort = 5056;
        private const int MaxQueue = 20000;
        private const int MaxBatch = 1500;
        private const int SendIntervalMs = 250;

        private static readonly object Gate = new object();
        private static readonly Queue<KeyValuePair<long, byte[]>> Pending = new Queue<KeyValuePair<long, byte[]>>();
        private static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        private static long captured;
        private static long forwarded;
        private static long dropped;
        private static long failedPosts;
        private static string lastPostError;
        private static volatile bool running = true;

        private static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            string app = args.Length > 0 ? args[0].Trim().TrimEnd('/') : "http://localhost:3100";
            Uri appUri;
            if (!Uri.TryCreate(app, UriKind.Absolute, out appUri) || (appUri.Scheme != "http" && appUri.Scheme != "https"))
            {
                Console.WriteLine("Geçersiz uygulama adresi: " + app);
                Console.WriteLine("Örnek: .\\AlbionCapture.exe http://192.168.1.20:3100");
                return 2;
            }
            if (!IsAdministrator())
            {
                Console.WriteLine("Bu program yönetici olarak çalıştırılmalı (Windows ham soket izni).");
                Console.WriteLine("PowerShell'i sağ tık > Yönetici olarak çalıştır ile açın, bu klasöre gelip komutu tekrar girin.");
                return 1;
            }

            List<IPAddress> addresses = LocalAddresses();
            int listening = 0;
            foreach (IPAddress ip in addresses)
            {
                try
                {
                    Socket sock = OpenRawSocket(ip);
                    IPAddress local = ip;
                    Thread t = new Thread(() => ReceiveLoop(sock, local));
                    t.IsBackground = true;
                    t.Start();
                    listening++;
                    Console.WriteLine("Dinleniyor: " + ip);
                }
                catch (Exception ex)
                {
                    Console.WriteLine("Atlandı: " + ip + " (" + ex.Message + ")");
                }
            }
            if (listening == 0)
            {
                Console.WriteLine("Hiçbir ağ arayüzü dinlenemedi.");
                return 1;
            }

            string ingestUrl = app + "/api/damage/ingest";
            Console.WriteLine("Paketler gönderiliyor: " + ingestUrl);
            Console.WriteLine("Durdurmak için Ctrl+C.");
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e)
            {
                e.Cancel = true;
                running = false;
            };

            Thread senderThread = new Thread(() => SendLoop(ingestUrl));
            senderThread.IsBackground = true;
            senderThread.Start();

            DateTime nextStatus = DateTime.UtcNow.AddSeconds(5);
            while (running)
            {
                Thread.Sleep(250);
                if (DateTime.UtcNow < nextStatus) continue;
                nextStatus = DateTime.UtcNow.AddSeconds(5);
                string line = string.Format(
                    "[{0:HH:mm:ss}] yakalanan {1}, gönderilen {2}, düşen {3}, başarısız istek {4}",
                    DateTime.Now, Interlocked.Read(ref captured), Interlocked.Read(ref forwarded),
                    Interlocked.Read(ref dropped), Interlocked.Read(ref failedPosts));
                Console.WriteLine(line);
                string err = lastPostError;
                if (err != null)
                {
                    Console.WriteLine("  son hata: " + err);
                    lastPostError = null;
                }
            }
            Console.WriteLine("Durduruldu.");
            return 0;
        }

        private static bool IsAdministrator()
        {
            using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
            {
                return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
            }
        }

        private static List<IPAddress> LocalAddresses()
        {
            List<IPAddress> list = new List<IPAddress>();
            foreach (NetworkInterface nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (UnicastIPAddressInformation ua in nic.GetIPProperties().UnicastAddresses)
                {
                    if (ua.Address.AddressFamily == AddressFamily.InterNetwork && !list.Contains(ua.Address)) list.Add(ua.Address);
                }
            }
            return list;
        }

        private static Socket OpenRawSocket(IPAddress ip)
        {
            Socket s = new Socket(AddressFamily.InterNetwork, SocketType.Raw, ProtocolType.IP);
            try
            {
                s.ReceiveBufferSize = 4 * 1024 * 1024;
                s.Bind(new IPEndPoint(ip, 0));
                s.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.HeaderIncluded, true);
                // SIO_RCVALL: receive copies of the IP packets on this interface. Read-only.
                s.IOControl(IOControlCode.ReceiveAll, new byte[] { 1, 0, 0, 0 }, new byte[4]);
                return s;
            }
            catch
            {
                s.Close();
                throw;
            }
        }

        private static void ReceiveLoop(Socket sock, IPAddress ip)
        {
            byte[] buf = new byte[65535];
            while (running)
            {
                int n;
                try
                {
                    n = sock.Receive(buf);
                }
                catch (SocketException ex)
                {
                    if (!running) break;
                    Console.WriteLine("Okuma hatası (" + ip + "): " + ex.Message);
                    Thread.Sleep(1000);
                    continue;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }

                if (n < 28 || (buf[0] >> 4) != 4) continue; // IPv4 only
                int ihl = (buf[0] & 0x0F) * 4;
                if (buf[9] != 17 || n < ihl + 8) continue; // UDP only
                bool moreFragments = (buf[6] & 0x20) != 0;
                int fragmentOffset = ((buf[6] & 0x1F) << 8) | buf[7];
                if (moreFragments || fragmentOffset != 0) continue; // Photon keeps datagrams below the MTU
                int srcPort = (buf[ihl] << 8) | buf[ihl + 1];
                if (srcPort != GamePort) continue; // only what the game server sends to us
                int udpLength = (buf[ihl + 4] << 8) | buf[ihl + 5];
                int payloadLength = Math.Min(udpLength - 8, n - ihl - 8);
                if (payloadLength <= 0) continue;

                byte[] payload = new byte[payloadLength];
                Buffer.BlockCopy(buf, ihl + 8, payload, 0, payloadLength);
                long t = (long)(DateTime.UtcNow - Epoch).TotalMilliseconds;
                Interlocked.Increment(ref captured);
                lock (Gate)
                {
                    if (Pending.Count >= MaxQueue)
                    {
                        Pending.Dequeue();
                        Interlocked.Increment(ref dropped);
                    }
                    Pending.Enqueue(new KeyValuePair<long, byte[]>(t, payload));
                }
            }
        }

        private sealed class ShortTimeoutWebClient : WebClient
        {
            protected override WebRequest GetWebRequest(Uri address)
            {
                WebRequest request = base.GetWebRequest(address);
                request.Timeout = 5000;
                return request;
            }
        }

        private static void SendLoop(string url)
        {
            ServicePointManager.Expect100Continue = false;
            using (ShortTimeoutWebClient client = new ShortTimeoutWebClient())
            {
                client.Encoding = Encoding.UTF8;
                while (running)
                {
                    Thread.Sleep(SendIntervalMs);
                    List<KeyValuePair<long, byte[]>> batch = new List<KeyValuePair<long, byte[]>>();
                    lock (Gate)
                    {
                        while (Pending.Count > 0 && batch.Count < MaxBatch) batch.Add(Pending.Dequeue());
                    }
                    if (batch.Count == 0) continue;

                    StringBuilder sb = new StringBuilder("{\"packets\":[");
                    for (int i = 0; i < batch.Count; i++)
                    {
                        if (i > 0) sb.Append(',');
                        sb.Append("{\"t\":").Append(batch[i].Key).Append(",\"d\":\"");
                        sb.Append(Convert.ToBase64String(batch[i].Value)).Append("\"}");
                    }
                    sb.Append("]}");

                    try
                    {
                        client.Headers[HttpRequestHeader.ContentType] = "application/json";
                        client.UploadString(url, "POST", sb.ToString());
                        Interlocked.Add(ref forwarded, batch.Count);
                    }
                    catch (WebException ex)
                    {
                        Interlocked.Increment(ref failedPosts);
                        Interlocked.Add(ref dropped, batch.Count);
                        lastPostError = ex.Message;
                    }
                }
            }
        }
    }
}
