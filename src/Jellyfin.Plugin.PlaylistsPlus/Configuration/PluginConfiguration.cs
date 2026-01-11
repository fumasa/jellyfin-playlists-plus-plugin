using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.PlaylistsPlus.Configuration;

public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// If true, UI uses higher default limit per page request.
    /// </summary>
    public bool PreferLargePages { get; set; } = true;

    /// <summary>
    /// Default page size used by the UI when requesting playlist items.
    /// </summary>
    public int DefaultPageSize { get; set; } = 200;

    /// <summary>
    /// Small delay between Move calls (ms) to reduce server pressure.
    /// </summary>
    public int MoveThrottleMs { get; set; } = 30;
}
