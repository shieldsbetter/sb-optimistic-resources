Vagrant.configure("2") do |config|
  config.vm.box = "shieldsbetter/pelton22"

  config.vm.synced_folder "vagrant/bin/", "/host/bin",
        mount_options: ["dmode=775,fmode=777"]

  config.vm.provider "virtualbox" do |v|
    v.memory = 2048
  end

  config.ssh.forward_agent = true
end
