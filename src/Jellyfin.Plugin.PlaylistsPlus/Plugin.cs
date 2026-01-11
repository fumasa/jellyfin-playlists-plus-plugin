using System;
using System.Collections.Generic;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;
using MediaBrowser.Controller.Plugins;

namespace Jellyfin.Plugin.PlaylistsPlus;

public class Plugin : BasePlugin<Configuration.PluginConfiguration>, IHasWebPages
{
    public static Plugin? Instance { get; private set; }

    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public override string Name => "Playlists Plus";
    public override Guid Id => Guid.Parse("b9b9a50f-8b3a-4d2a-9c0e-7e2d0d7c2d73");

    /// <summary>
    /// Adds a custom page inside Dashboard → Plugins → Playlists Plus.
    /// This uses embedded resources served by the plugin.
    /// </summary>
    public IEnumerable<PluginPageInfo> GetPages()
    {
        // The "Name" becomes part of the dashboard route:
        //   /web/index.html#!/dashboard/plugin/b9b9a50f-8b3a-4d2a-9c0e-7e2d0d7c2d73/PlaylistsPlus
        //
        // The EmbeddedResourcePath MUST match the resource name in the assembly.
        yield return new PluginPageInfo
        {
            Name = "PlaylistsPlus",
            EmbeddedResourcePath = GetType().Namespace + ".Configuration.configPage.html"
        };
        yield return new PluginPageInfo
        {
            Name = "playlistsplus.js",
            EmbeddedResourcePath = GetType().Namespace + ".Configuration.playlistsplus.js"
        };
        yield return new PluginPageInfo
        {
            Name = "playlistsplus.css",
            EmbeddedResourcePath = GetType().Namespace + ".Configuration.playlistsplus.css"
        };
    }
}
