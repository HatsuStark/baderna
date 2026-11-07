// Captura o áudio de um processo (e filhos), ou de tudo menos um processo,
// usando WASAPI process loopback (Windows 10 build 20348+ / Windows 11).
//
// Uso:
//   proc-audio.exe include <pid>    só o áudio desse processo e filhos
//   proc-audio.exe exclude <pid>    todo o áudio do sistema menos esse processo e filhos
//   proc-audio.exe window  <hwnd>   como include, usando o dono da janela
//
// Saída: PCM 16-bit, 48 kHz, estéreo intercalado em stdout.
// Modo window: escreve "title:<título da janela em UTF-8>" em stderr quando
// muda (rádio da sala mostra a música) e sai com código 4 se a janela fechar.
// Termina quando stdin fecha (processo pai morreu) ou stdout quebra.

#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>
#include <wrl/implements.h>

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cwchar>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

constexpr DWORD kSampleRate = 48000;
constexpr WORD kChannels = 2;
constexpr WORD kBits = 16;
// 200 ms (unidades de 100 ns). Folga pra quando o stdout demora a ser lido:
// com buffer curto o Windows descarta áudio na origem e o som engasga.
constexpr REFERENCE_TIME kBufferDuration = 2000000;
constexpr ULONGLONG kTitleEveryMs = 1000;

std::atomic<bool> g_stop{false};

class ActivationHandler
    : public Microsoft::WRL::RuntimeClass<Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
                                          Microsoft::WRL::FtmBase, IActivateAudioInterfaceCompletionHandler> {
 public:
  ActivationHandler() : done(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}
  ~ActivationHandler() override { CloseHandle(done); }

  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT activateHr = E_FAIL;
    ComPtr<IUnknown> unk;
    HRESULT hr = op->GetActivateResult(&activateHr, &unk);
    if (SUCCEEDED(hr)) hr = activateHr;
    if (SUCCEEDED(hr)) hr = unk.As(&client);
    result = hr;
    SetEvent(done);
    return S_OK;
  }

  HANDLE done;
  HRESULT result = E_FAIL;
  ComPtr<IAudioClient> client;
};

DWORD WINAPI WatchStdin(LPVOID) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  char buf[256];
  DWORD n = 0;
  while (ReadFile(in, buf, sizeof buf, &n, nullptr) && n > 0) {
  }
  g_stop = true;
  return 0;
}

// Manda o título da janela pro stderr se mudou. false = a janela fechou.
bool ReportTitle(HWND hwnd, std::wstring& last) {
  if (!IsWindow(hwnd)) return false;
  wchar_t buf[512];
  const int n = GetWindowTextW(hwnd, buf, 512);
  std::wstring title(buf, n > 0 ? n : 0);
  for (auto& ch : title) {
    if (ch == L'\r' || ch == L'\n') ch = L' ';
  }
  if (title == last) return true;
  last = title;
  const int bytes = WideCharToMultiByte(CP_UTF8, 0, title.c_str(), static_cast<int>(title.size()), nullptr, 0, nullptr, nullptr);
  std::string utf8(bytes > 0 ? bytes : 0, '\0');
  if (bytes > 0) WideCharToMultiByte(CP_UTF8, 0, title.c_str(), static_cast<int>(title.size()), utf8.data(), bytes, nullptr, nullptr);
  fprintf(stderr, "title:%s\n", utf8.c_str());
  fflush(stderr);
  return true;
}

int Fail(const char* what, HRESULT hr) {
  fprintf(stderr, "%s falhou: 0x%08lx\n", what, static_cast<unsigned long>(hr));
  return 1;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc != 3) {
    fwprintf(stderr, L"uso: %ls include|exclude <pid> | window <hwnd>\n", argv[0]);
    return 2;
  }

  const unsigned long long value = wcstoull(argv[2], nullptr, 10);
  PROCESS_LOOPBACK_MODE mode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  DWORD pid = 0;
  HWND hwnd = nullptr;
  if (!wcscmp(argv[1], L"include")) {
    pid = static_cast<DWORD>(value);
  } else if (!wcscmp(argv[1], L"exclude")) {
    pid = static_cast<DWORD>(value);
    mode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  } else if (!wcscmp(argv[1], L"window")) {
    hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(value));
    GetWindowThreadProcessId(hwnd, &pid);
  } else {
    fprintf(stderr, "modo inválido\n");
    return 2;
  }
  if (!pid) {
    fprintf(stderr, "processo não encontrado\n");
    return 3;
  }
  fprintf(stderr, "pid %lu modo %s\n", pid, mode == PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE ? "include" : "exclude");

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return Fail("CoInitializeEx", hr);

  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = mode;

  PROPVARIANT activateParams = {};
  activateParams.vt = VT_BLOB;
  activateParams.blob.cbSize = sizeof(params);
  activateParams.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  auto handler = Microsoft::WRL::Make<ActivationHandler>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> op;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &activateParams,
                                   handler.Get(), &op);
  if (FAILED(hr)) return Fail("ActivateAudioInterfaceAsync", hr);
  if (WaitForSingleObject(handler->done, 5000) != WAIT_OBJECT_0) return Fail("ativação (timeout)", E_FAIL);
  if (FAILED(handler->result)) return Fail("ativação", handler->result);
  ComPtr<IAudioClient> client = handler->client;

  // Process loopback não suporta GetMixFormat; o formato é escolhido por nós
  // e o Windows converte (AUTOCONVERTPCM).
  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = kChannels;
  format.nSamplesPerSec = kSampleRate;
  format.wBitsPerSample = kBits;
  format.nBlockAlign = kChannels * kBits / 8;
  format.nAvgBytesPerSec = kSampleRate * format.nBlockAlign;

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                              AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                          kBufferDuration, 0, &format, nullptr);
  if (FAILED(hr)) return Fail("IAudioClient::Initialize", hr);

  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = client->SetEventHandle(ready);
  if (FAILED(hr)) return Fail("SetEventHandle", hr);

  ComPtr<IAudioCaptureClient> capture;
  hr = client->GetService(IID_PPV_ARGS(&capture));
  if (FAILED(hr)) return Fail("GetService", hr);

  CreateThread(nullptr, 0, WatchStdin, nullptr, 0, nullptr);

  hr = client->Start();
  if (FAILED(hr)) return Fail("Start", hr);

  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  std::vector<BYTE> silence;
  std::wstring lastTitle;
  ULONGLONG nextTitle = 0;
  int exitCode = 0;
  while (!g_stop) {
    if (hwnd && GetTickCount64() >= nextTitle) {
      nextTitle = GetTickCount64() + kTitleEveryMs;
      if (!ReportTitle(hwnd, lastTitle)) {
        fprintf(stderr, "a janela do app fechou\n");
        exitCode = 4;
        break;
      }
    }
    // Sem nada tocando não chegam pacotes; o timeout só serve pra checar g_stop.
    if (WaitForSingleObject(ready, 100) != WAIT_OBJECT_0) continue;
    UINT32 packet = 0;
    while (!g_stop && SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
      const DWORD bytes = frames * format.nBlockAlign;
      const BYTE* src = data;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        silence.assign(bytes, 0);
        src = silence.data();
      }
      DWORD written = 0;
      const BOOL ok = WriteFile(out, src, bytes, &written, nullptr);
      capture->ReleaseBuffer(frames);
      if (!ok) g_stop = true;
    }
  }

  client->Stop();
  CloseHandle(ready);
  CoUninitialize();
  return exitCode;
}
